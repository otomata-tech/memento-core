// Helpers de présentation des blocs (portés du design « Éditorial fidèle »).
// Sémantique couleur des types = le langage, pas le style → constante.
import { marked } from "marked";
import DOMPurify from "dompurify";
import type { Block } from "../api";

/** Rôle visuel par type de bloc (jaune=normatif, bleu=définition, vert=pratique, rouge=garde-fou). */
export const TYPE_ROLE: Record<string, string> = {
  PRINCIPE: "primary", REGLE: "primary",
  DEFINITION: "accent", QUESTION: "accent",
  PROCEDURE: "strong", EXEMPLE: "strong", PROMPT_PORTEUR: "strong", PROMPT_SYSTEME: "strong",
  MISE_EN_GARDE: "weak", EXCEPTION: "weak",
  PROSE: "mute",
};
export const roleClass = (type: string): string => "role-" + (TYPE_ROLE[type] ?? "mute");

export const RELLABEL: Record<string, string> = {
  CONTRADICTS: "contredit", SUPERSEDES: "remplace", DEPENDS_ON: "dépend de", REFERENCES: "référence",
};
export const RELGLYPH: Record<string, string> = {
  CONTRADICTS: "⚡", SUPERSEDES: "⇡", DEPENDS_ON: "⇠", REFERENCES: "→",
};
/** Classe d'accent d'une relation (rouge pour les cas précieux, bleu pour les appuis). */
export const relClass = (rel: string): string =>
  rel === "CONTRADICTS" || rel === "SUPERSEDES" ? "warn"
    : rel === "REFERENCES" || rel === "DEPENDS_ON" ? "accent" : "";

/** Marque de confiance : [classe css, libellé]. */
export function trustMark(b: Pick<Block, "verifiedAt" | "sources">): [string, string] {
  if (b.verifiedAt) return ["ok", "✓ vérifié"];
  return b.sources.length ? ["", "○ non vérifié"] : ["no", "⚠ sans source"];
}

/** Rendu markdown sanitisé (contenu scrappé → non fiable). Identique à DocumentPane. */
export function renderMd(md: string): string {
  return DOMPurify.sanitize(marked.parse(md ?? "", { async: false }) as string);
}

/** N'autorise que les schémas sûrs pour un href de source. */
export function safeHref(u: string | null | undefined): string | undefined {
  return u && /^(https?:|mailto:|\/)/i.test(u) ? u : undefined;
}

export interface Neighbour { rel: string; otherId: string; note: string | null }

/**
 * Voisins d'un bloc groupés par relation (dédup des liens symétriques).
 * Combine liens sortants (linksFrom→toBlockId) et entrants (linksTo→fromBlockId).
 */
export function neighbours(center: Block): Record<string, Neighbour[]> {
  const all: Neighbour[] = [
    ...center.linksFrom.map((l) => ({ rel: l.relation, otherId: l.toBlockId!, note: l.note })),
    ...center.linksTo.map((l) => ({ rel: l.relation, otherId: l.fromBlockId!, note: l.note })),
  ].filter((n) => n.otherId);
  const by: Record<string, Neighbour[]> = {};
  const seen = new Set<string>();
  for (const n of all) {
    const k = n.rel + ":" + n.otherId;
    if (seen.has(k)) continue;
    seen.add(k);
    (by[n.rel] ??= []).push(n);
  }
  return by;
}
