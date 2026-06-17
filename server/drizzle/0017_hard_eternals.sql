CREATE TABLE "mem_pinned_workspaces" (
	"user_id" text NOT NULL,
	"workspace_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mem_pinned_workspaces_user_id_workspace_id_pk" PRIMARY KEY("user_id","workspace_id")
);
--> statement-breakpoint
ALTER TABLE "mem_pinned_workspaces" ADD CONSTRAINT "mem_pinned_workspaces_workspace_id_mem_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."mem_workspaces"("id") ON DELETE cascade ON UPDATE no action;