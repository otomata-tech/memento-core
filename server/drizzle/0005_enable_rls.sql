-- Active Row Level Security sur toutes les tables mem_* (advisor Supabase
-- `rls_disabled_in_public`). Le schéma `public` est exposé par PostgREST (Data API)
-- aux rôles `anon`/`authenticated` via la clé anon publique du front : sans RLS,
-- n'importe qui peut lire/écrire/supprimer tout le contenu en tapant PostgREST
-- directement, en contournant le contrôle d'accès des Edge Functions.
--
-- Aucun client ne passe par la Data API : le front (`app/`) n'utilise Supabase que
-- pour l'auth (zéro `.from()`), toute la donnée transite par les Edge Functions
-- `mcp`/`api` qui se connectent via DATABASE_URL en tant que rôle propriétaire des
-- tables — lequel CONTOURNE la RLS (pas de FORCE). Donc : RLS activée + aucune
-- policy = deny-all pour anon/authenticated, runtime inchangé.
ALTER TABLE "mem_orgs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "mem_memberships" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "mem_workspaces" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "mem_sections" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "mem_documents" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "mem_blocks" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "mem_sources" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "mem_block_sources" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "mem_links" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "mem_comments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "mem_revisions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "mem_ingestions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "mem_settings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "mem_user_prefs" ENABLE ROW LEVEL SECURITY;
