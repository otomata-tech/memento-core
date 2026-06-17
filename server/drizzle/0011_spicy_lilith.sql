CREATE TYPE "public"."mem_ws_visibility" AS ENUM('org', 'private');--> statement-breakpoint
CREATE TABLE "mem_workspace_grants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"role" text DEFAULT 'member' NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "mem_orgs" ADD COLUMN "personal_for" text;--> statement-breakpoint
ALTER TABLE "mem_workspaces" ADD COLUMN "visibility" "mem_ws_visibility" DEFAULT 'org' NOT NULL;--> statement-breakpoint
ALTER TABLE "mem_workspace_grants" ADD CONSTRAINT "mem_workspace_grants_workspace_id_mem_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."mem_workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "mem_ws_grants_ws_user" ON "mem_workspace_grants" USING btree ("workspace_id","user_id");--> statement-breakpoint
CREATE INDEX "mem_ws_grants_user" ON "mem_workspace_grants" USING btree ("user_id");--> statement-breakpoint
ALTER TABLE "mem_orgs" ADD CONSTRAINT "mem_orgs_personal_for_unique" UNIQUE("personal_for");--> statement-breakpoint
-- Filet RLS deny-all (cohérent migration 0005) : l'accès passe par les Edge
-- Functions (rôle propriétaire, bypass) ; aucune policy = deny pour le reste.
ALTER TABLE "mem_workspace_grants" ENABLE ROW LEVEL SECURITY;
