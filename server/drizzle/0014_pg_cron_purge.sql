-- Purge automatique des fenêtres de rate limit périmées (issue #67).
-- pg_cron (Supabase) : job quotidien à 03:00 UTC. Spécifique Supabase, comme 0006
-- (pgvector) — échoue sur un Postgres local sans pg_cron, au même titre.
CREATE EXTENSION IF NOT EXISTS pg_cron;--> statement-breakpoint
SELECT cron.schedule(
  'memento-purge-rate-limits',
  '0 3 * * *',
  $$DELETE FROM mem_rate_limits WHERE window_start < now() - interval '1 day'$$
);
