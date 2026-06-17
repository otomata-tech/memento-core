CREATE TYPE "public"."mem_block_type" AS ENUM('PROSE', 'PRINCIPE', 'REGLE', 'EXCEPTION', 'EXEMPLE', 'PROCEDURE', 'MISE_EN_GARDE', 'DEFINITION', 'QUESTION', 'PROMPT_PORTEUR', 'PROMPT_SYSTEME');--> statement-breakpoint
CREATE TYPE "public"."mem_comment_target" AS ENUM('BLOCK', 'DOCUMENT', 'SECTION');--> statement-breakpoint
CREATE TYPE "public"."mem_doc_status" AS ENUM('DRAFT', 'ACTIVE', 'DEPRECATED');--> statement-breakpoint
CREATE TYPE "public"."mem_ingestion_status" AS ENUM('PROPOSED', 'APPLIED', 'REJECTED', 'PARTIAL');--> statement-breakpoint
CREATE TYPE "public"."mem_link_relation" AS ENUM('REFERENCES', 'DEPENDS_ON', 'CONTRADICTS', 'SUPERSEDES', 'RELATED');--> statement-breakpoint
CREATE TYPE "public"."mem_source_kind" AS ENUM('FILE', 'URL', 'MANUAL');--> statement-breakpoint
CREATE TABLE "mem_block_sources" (
	"block_id" uuid NOT NULL,
	"source_id" uuid NOT NULL,
	"locator" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mem_block_sources_block_id_source_id_pk" PRIMARY KEY("block_id","source_id")
);
--> statement-breakpoint
CREATE TABLE "mem_blocks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_id" uuid NOT NULL,
	"type" "mem_block_type" DEFAULT 'PROSE' NOT NULL,
	"content" text DEFAULT '' NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"verified_at" timestamp with time zone,
	"verified_by" text,
	"created_by" text,
	"updated_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mem_comments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"target_type" "mem_comment_target" NOT NULL,
	"target_id" uuid NOT NULL,
	"body" text NOT NULL,
	"author" text NOT NULL,
	"author_kind" text DEFAULT 'human' NOT NULL,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mem_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"section_id" uuid NOT NULL,
	"title" text NOT NULL,
	"slug" text NOT NULL,
	"summary" text DEFAULT '' NOT NULL,
	"kind" text,
	"status" "mem_doc_status" DEFAULT 'DRAFT' NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_by" text,
	"updated_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mem_ingestions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"source_id" uuid,
	"title" text NOT NULL,
	"status" "mem_ingestion_status" DEFAULT 'PROPOSED' NOT NULL,
	"proposal" jsonb NOT NULL,
	"summary" text DEFAULT '' NOT NULL,
	"created_by" text,
	"decided_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "mem_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"from_block_id" uuid NOT NULL,
	"to_block_id" uuid NOT NULL,
	"relation" "mem_link_relation" NOT NULL,
	"note" text,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mem_revisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"target_type" text NOT NULL,
	"target_id" uuid,
	"op" text NOT NULL,
	"reason" text NOT NULL,
	"actor" text NOT NULL,
	"actor_kind" text DEFAULT 'human' NOT NULL,
	"before" jsonb,
	"after" jsonb,
	"ingestion_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mem_sections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"parent_id" uuid,
	"title" text NOT NULL,
	"slug" text NOT NULL,
	"summary" text DEFAULT '' NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"depth" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mem_settings" (
	"workspace_id" uuid NOT NULL,
	"key" text NOT NULL,
	"value" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mem_settings_workspace_id_key_pk" PRIMARY KEY("workspace_id","key")
);
--> statement-breakpoint
CREATE TABLE "mem_sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" "mem_source_kind" NOT NULL,
	"title" text NOT NULL,
	"ref" text,
	"citation" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mem_workspaces" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"summary" text DEFAULT '' NOT NULL,
	"org_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mem_workspaces_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
ALTER TABLE "mem_block_sources" ADD CONSTRAINT "mem_block_sources_block_id_mem_blocks_id_fk" FOREIGN KEY ("block_id") REFERENCES "public"."mem_blocks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mem_block_sources" ADD CONSTRAINT "mem_block_sources_source_id_mem_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."mem_sources"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mem_blocks" ADD CONSTRAINT "mem_blocks_document_id_mem_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."mem_documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mem_documents" ADD CONSTRAINT "mem_documents_section_id_mem_sections_id_fk" FOREIGN KEY ("section_id") REFERENCES "public"."mem_sections"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mem_ingestions" ADD CONSTRAINT "mem_ingestions_workspace_id_mem_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."mem_workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mem_links" ADD CONSTRAINT "mem_links_from_block_id_mem_blocks_id_fk" FOREIGN KEY ("from_block_id") REFERENCES "public"."mem_blocks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mem_links" ADD CONSTRAINT "mem_links_to_block_id_mem_blocks_id_fk" FOREIGN KEY ("to_block_id") REFERENCES "public"."mem_blocks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mem_revisions" ADD CONSTRAINT "mem_revisions_workspace_id_mem_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."mem_workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mem_sections" ADD CONSTRAINT "mem_sections_workspace_id_mem_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."mem_workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mem_sections" ADD CONSTRAINT "mem_sections_parent_id_mem_sections_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."mem_sections"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mem_settings" ADD CONSTRAINT "mem_settings_workspace_id_mem_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."mem_workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "mem_blocks_doc_pos" ON "mem_blocks" USING btree ("document_id","position");--> statement-breakpoint
CREATE INDEX "mem_comments_target" ON "mem_comments" USING btree ("target_type","target_id");--> statement-breakpoint
CREATE UNIQUE INDEX "mem_documents_section_slug" ON "mem_documents" USING btree ("section_id","slug");--> statement-breakpoint
CREATE INDEX "mem_documents_section_pos" ON "mem_documents" USING btree ("section_id","position");--> statement-breakpoint
CREATE INDEX "mem_ingestions_ws_status" ON "mem_ingestions" USING btree ("workspace_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "mem_links_from_to_rel" ON "mem_links" USING btree ("from_block_id","to_block_id","relation");--> statement-breakpoint
CREATE INDEX "mem_links_to" ON "mem_links" USING btree ("to_block_id");--> statement-breakpoint
CREATE INDEX "mem_revisions_target" ON "mem_revisions" USING btree ("workspace_id","target_type","target_id","created_at");--> statement-breakpoint
CREATE INDEX "mem_revisions_ingestion" ON "mem_revisions" USING btree ("ingestion_id");--> statement-breakpoint
CREATE UNIQUE INDEX "mem_sections_ws_parent_slug" ON "mem_sections" USING btree ("workspace_id","parent_id","slug");--> statement-breakpoint
CREATE INDEX "mem_sections_ws_parent_pos" ON "mem_sections" USING btree ("workspace_id","parent_id","position");--> statement-breakpoint
CREATE INDEX "mem_sources_kind" ON "mem_sources" USING btree ("kind");