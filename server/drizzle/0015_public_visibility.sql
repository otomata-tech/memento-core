-- KB publique (galerie + recherche publique) : 3e périmètre de partage `public`.
-- Une KB publique est lisible et cherchable par TOUS (anonyme inclus) ; l'écriture
-- reste curator/admin (org propriétaire ou grant). Postgres ne sait pas ajouter une
-- valeur d'enum dans une transaction de façon portable → recréation du type comme 0008.
ALTER TABLE "mem_workspaces" ALTER COLUMN "visibility" DROP DEFAULT;--> statement-breakpoint
ALTER TYPE "mem_ws_visibility" RENAME TO "mem_ws_visibility_old";--> statement-breakpoint
CREATE TYPE "mem_ws_visibility" AS ENUM('org', 'private', 'public');--> statement-breakpoint
ALTER TABLE "mem_workspaces" ALTER COLUMN "visibility" TYPE "mem_ws_visibility" USING "visibility"::text::"mem_ws_visibility";--> statement-breakpoint
DROP TYPE "mem_ws_visibility_old";--> statement-breakpoint
ALTER TABLE "mem_workspaces" ALTER COLUMN "visibility" SET DEFAULT 'org';
