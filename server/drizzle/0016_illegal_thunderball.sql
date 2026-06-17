-- Ping-pong de revue (boucle propose-valide) : un humain peut renvoyer une ingestion
-- à l'agent pour révision (statut CHANGES_REQUESTED) avec une note de revue globale.
-- Le feedback par changement vit dans le jsonb `proposal`. PG15 → ADD VALUE supporté
-- (idempotent IF NOT EXISTS ; la ligne `mem_ws_visibility` générée à tort est retirée :
-- la valeur 'public' existe déjà en prod via 0015, snapshot drizzle resté en retard).
ALTER TYPE "public"."mem_ingestion_status" ADD VALUE IF NOT EXISTS 'CHANGES_REQUESTED';--> statement-breakpoint
ALTER TABLE "mem_ingestions" ADD COLUMN "review_note" text;
