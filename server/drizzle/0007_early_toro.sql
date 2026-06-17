ALTER TABLE "mem_blocks" ADD COLUMN "client_key" text;--> statement-breakpoint
ALTER TABLE "mem_documents" ADD COLUMN "client_key" text;--> statement-breakpoint
ALTER TABLE "mem_ingestions" ADD COLUMN "client_key" text;--> statement-breakpoint
CREATE UNIQUE INDEX "mem_blocks_doc_client_key" ON "mem_blocks" USING btree ("document_id","client_key");--> statement-breakpoint
CREATE UNIQUE INDEX "mem_documents_section_client_key" ON "mem_documents" USING btree ("section_id","client_key");--> statement-breakpoint
CREATE UNIQUE INDEX "mem_ingestions_ws_client_key" ON "mem_ingestions" USING btree ("workspace_id","client_key");