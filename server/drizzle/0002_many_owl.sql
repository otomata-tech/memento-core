CREATE TABLE "mem_memberships" (
	"org_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"role" text DEFAULT 'member' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mem_memberships_org_id_user_id_pk" PRIMARY KEY("org_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "mem_orgs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mem_orgs_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
ALTER TABLE "mem_workspaces" ALTER COLUMN "org_id" SET DATA TYPE uuid USING "org_id"::uuid;--> statement-breakpoint
ALTER TABLE "mem_memberships" ADD CONSTRAINT "mem_memberships_org_id_mem_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."mem_orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "mem_memberships_user" ON "mem_memberships" USING btree ("user_id");--> statement-breakpoint
ALTER TABLE "mem_workspaces" ADD CONSTRAINT "mem_workspaces_org_id_mem_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."mem_orgs"("id") ON DELETE restrict ON UPDATE no action;