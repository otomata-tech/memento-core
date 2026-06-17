-- Suppression du statut DRAFT (issue #59) : un document est ACTIVE ou DEPRECATED.
-- Le « pas encore validé » est porté par la boucle propose-valide (MemIngestion),
-- pas par un statut sur le document. Postgres ne sait pas retirer une valeur
-- d'un enum → recréation du type.
UPDATE "mem_documents" SET "status" = 'ACTIVE' WHERE "status" = 'DRAFT';--> statement-breakpoint
ALTER TABLE "mem_documents" ALTER COLUMN "status" DROP DEFAULT;--> statement-breakpoint
ALTER TYPE "mem_doc_status" RENAME TO "mem_doc_status_old";--> statement-breakpoint
CREATE TYPE "mem_doc_status" AS ENUM('ACTIVE', 'DEPRECATED');--> statement-breakpoint
ALTER TABLE "mem_documents" ALTER COLUMN "status" TYPE "mem_doc_status" USING "status"::text::"mem_doc_status";--> statement-breakpoint
DROP TYPE "mem_doc_status_old";--> statement-breakpoint
ALTER TABLE "mem_documents" ALTER COLUMN "status" SET DEFAULT 'ACTIVE';
