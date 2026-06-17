-- Journal des appels de tools MCP — schéma CANONIQUE otomata-calllog
-- (lib /data/oto/otomata-calllog, contrat inter-projets : mêmes colonnes que
-- ogic/ytmusic pour dashboards comparables ; d'où l'absence de préfixe mem_).
-- Rempli par _shared/calllog.ts (fire-and-forget). RLS deny-all comme 0005.
CREATE TABLE IF NOT EXISTS "tool_calls" (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    server TEXT NOT NULL,
    sub TEXT,
    email TEXT,
    tool TEXT NOT NULL,
    args JSONB,
    ok BOOLEAN NOT NULL,
    error TEXT,
    duration_ms INTEGER
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS tool_calls_server_tool ON "tool_calls" (server, tool, created_at);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS tool_calls_sub ON "tool_calls" (sub, created_at);--> statement-breakpoint
ALTER TABLE "tool_calls" ENABLE ROW LEVEL SECURITY;
