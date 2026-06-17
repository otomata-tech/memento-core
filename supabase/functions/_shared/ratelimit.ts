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
} as const;

export type Bucket = keyof typeof LIMITS;

/**
 * Incrémente atomiquement le compteur de la fenêtre courante et lève
 * RateLimitError si le plafond est dépassé. Fenêtre alignée sur l'horloge
 * serveur (now() Postgres) pour éviter le clock-skew entre isolates.
 */
export async function assertWithinLimit(sub: string, bucket: Bucket): Promise<void> {
  if (!sub) return; // pas d'identité → déjà rejeté par l'auth en amont
  const { max, windowSec } = LIMITS[bucket];
  const rows = await db.execute<{ count: number }>(sql`
    INSERT INTO mem_rate_limits (sub, bucket, window_start, count)
    VALUES (
      ${sub}, ${bucket},
      to_timestamp(floor(extract(epoch from now()) / ${windowSec}) * ${windowSec}),
      1
    )
    ON CONFLICT (sub, bucket, window_start)
    DO UPDATE SET count = mem_rate_limits.count + 1
    RETURNING count
  `);
  const count = Number(rows[0]?.count ?? 0);
  if (count > max) {
    throw new RateLimitError(
      `trop de requêtes (${bucket}) : maximum ${max} par ${Math.round(windowSec / 60) || 1} min — réessaie plus tard`,
    );
  }
}
