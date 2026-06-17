/**
 * Rate limiting applicatif (issue #67, finding #2 audit sécu). Compteur à fenêtre
 * fixe par (utilisateur, bucket), backé Postgres (table `mem_rate_limits`, état
 * partagé entre les isolates Edge stateless). Cible les verbes à effet de bord
 * coûteux : invitations (emails GoTrue), createOrg, recherche globale.
 *
 * Défense applicative (par `sub` ET par verbe) ; complémentaire d'un éventuel WAF
 * Cloudflare par IP (cf. docs/deployment-edge.md). Le limiteur n'est PAS une
 * barrière d'autorisation : il borne le débit, pas le droit.
 */
import { sql } from "drizzle-orm";
import { db } from "./db.ts";

/** Dépassement de débit — mappé en 429 (REST) / message agent (MCP) aux boundaries. */
export class RateLimitError extends Error {}

/** Plafonds par bucket : { max appels, fenêtre en secondes }. */
export const LIMITS = {
  invite: { max: 20, windowSec: 3600 }, // emails d'invitation (grant + membres)
  create_org: { max: 10, windowSec: 3600 },
  search_global: { max: 60, windowSec: 60 },
  // Recherche publique : seuls les appels AUTHENTIFIÉS sont comptés (sub vide =
  // no-op, cf. assertWithinLimit) ; l'anonyme est borné par le WAF Cloudflare/IP.
  search_public: { max: 60, windowSec: 60 },
  // Agent public (mode chat d'une KB publique). Surface anonyme et coûteuse (LLM) :
  // débit borné PAR IP (assertWithinLimitByKey, comptée même sans sub) + un plafond
  // de TOKENS journalier GLOBAL (recordUsage/currentUsage) qui borne la facture quel
  // que soit le nombre d'IP. `max` du budget = total_tokens/jour (env AGENT_DAILY_TOKEN_BUDGET).
  agent_ip_min: { max: 8, windowSec: 60 },
  agent_ip_hour: { max: 40, windowSec: 3600 },
  agent_budget: { max: Number(Deno.env.get("AGENT_DAILY_TOKEN_BUDGET") ?? "2000000"), windowSec: 86400 },
} as const;

export type Bucket = keyof typeof LIMITS;

/**
 * Incrémente atomiquement le compteur de la fenêtre courante de `by` et renvoie le
 * total. Fenêtre alignée sur l'horloge serveur (now() Postgres) pour éviter le
 * clock-skew entre isolates. `key` = identité de comptage (sub, IP, ou clé globale).
 */
async function bumpWindow(key: string, bucket: Bucket, by: number): Promise<number> {
  const { windowSec } = LIMITS[bucket];
  const rows = await db.execute<{ count: number }>(sql`
    INSERT INTO mem_rate_limits (sub, bucket, window_start, count)
    VALUES (
      ${key}, ${bucket},
      to_timestamp(floor(extract(epoch from now()) / ${windowSec}) * ${windowSec}),
      ${by}
    )
    ON CONFLICT (sub, bucket, window_start)
    DO UPDATE SET count = mem_rate_limits.count + ${by}
    RETURNING count
  `);
  return Number(rows[0]?.count ?? 0);
}

function limitError(bucket: Bucket): RateLimitError {
  const { max, windowSec } = LIMITS[bucket];
  return new RateLimitError(
    `trop de requêtes (${bucket}) : maximum ${max} par ${Math.round(windowSec / 60) || 1} min — réessaie plus tard`,
  );
}

/** Débit par `sub` (utilisateur). Anonyme (sub vide) = no-op : déjà rejeté par
 *  l'auth en amont, ou borné par le WAF/IP. */
export async function assertWithinLimit(sub: string, bucket: Bucket): Promise<void> {
  if (!sub) return;
  if (await bumpWindow(sub, bucket, 1) > LIMITS[bucket].max) throw limitError(bucket);
}

/** Débit par clé arbitraire NON vide (ex. IP sur une surface anonyme). Contrairement
 *  à assertWithinLimit, compte toujours — c'est la borne anti-rafale de l'anonyme. */
export async function assertWithinLimitByKey(key: string, bucket: Bucket): Promise<void> {
  if (!key) return;
  if (await bumpWindow(key, bucket, 1) > LIMITS[bucket].max) throw limitError(bucket);
}

/** Total courant de la fenêtre (sans incrémenter) — pour vérifier un plafond avant
 *  d'engager un coût (ex. budget tokens journalier). */
export async function currentUsage(key: string, bucket: Bucket): Promise<number> {
  const { windowSec } = LIMITS[bucket];
  const rows = await db.execute<{ count: number }>(sql`
    SELECT count FROM mem_rate_limits
    WHERE sub = ${key} AND bucket = ${bucket}
      AND window_start = to_timestamp(floor(extract(epoch from now()) / ${windowSec}) * ${windowSec})
  `);
  return Number(rows[0]?.count ?? 0);
}

/** Ajoute une consommation mesurée (ex. tokens LLM) au compteur de fenêtre. */
export async function recordUsage(key: string, bucket: Bucket, amount: number): Promise<void> {
  if (amount > 0) await bumpWindow(key, bucket, amount);
}
