CREATE TABLE "mem_user_prefs" (
	"user_id" text PRIMARY KEY NOT NULL,
	"default_workspace_id" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "mem_user_prefs" ADD CONSTRAINT "mem_user_prefs_default_workspace_id_mem_workspaces_id_fk" FOREIGN KEY ("default_workspace_id") REFERENCES "public"."mem_workspaces"("id") ON DELETE set null ON UPDATE no action;