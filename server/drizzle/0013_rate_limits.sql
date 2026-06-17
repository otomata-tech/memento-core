-- Rate limiting applicatif (issue #67, finding #2 audit sécu) — compteur à
-- fenêtre fixe par (utilisateur, bucket, fenêtre). Anti-abus : spam d'invitations
-- (emails GoTrue), createOrg en boucle, recherche globale coûteuse.
-- Accès en SQL brut depuis _shared/ratelimit.ts (upsert-incrément atomique) — pas
-- dans le schéma Drizzle (aucun SELECT ORM ne la touche), comme tool_calls.
-- RLS deny-all comme 0005 ; le rôle propriétaire (Edge Functions) bypasse.
-- Purge des fenêtres périmées : DELETE WHERE window_start < now() - interval '1 day'
-- (cron/manuel — volume faible, seuls les verbes sensibles écrivent ici).
CREATE TABLE IF NOT EXISTS "mem_rate_limits" (
    sub TEXT NOT NULL,
    bucket TEXT NOT NULL,
    window_start TIMESTAMPTZ NOT NULL,
    count INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (sub, bucket, window_start)
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS mem_rate_limits_window ON "mem_rate_limits" (window_start);--> statement-breakpoint
ALTER TABLE "mem_rate_limits" ENABLE ROW LEVEL SECURITY;
