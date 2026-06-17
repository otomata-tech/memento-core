CREATE TABLE "mem_usage_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"workspace_slug" text,
	"verb" text,
	"kind" text NOT NULL,
	"summary" text NOT NULL,
	"detail" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "mem_usage_logs_user" ON "mem_usage_logs" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "mem_usage_logs_ws" ON "mem_usage_logs" USING btree ("workspace_slug","created_at");