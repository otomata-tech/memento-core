-- Full-text search par bloc (spec §7). Hors DSL Drizzle : colonne tsvector
-- maintenue par trigger, config `french_unaccent` (français + unaccent), index GIN.
CREATE EXTENSION IF NOT EXISTS unaccent;--> statement-breakpoint
CREATE TEXT SEARCH CONFIGURATION french_unaccent ( COPY = french );--> statement-breakpoint
ALTER TEXT SEARCH CONFIGURATION french_unaccent
  ALTER MAPPING FOR hword, hword_part, word WITH unaccent, french_stem;--> statement-breakpoint
ALTER TABLE "mem_blocks" ADD COLUMN "search_vector" tsvector;--> statement-breakpoint
CREATE FUNCTION mem_blocks_search_vector_update() RETURNS trigger AS $$
BEGIN
  NEW.search_vector := to_tsvector('french_unaccent', coalesce(NEW.content, ''));
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER mem_blocks_search_vector_trg
  BEFORE INSERT OR UPDATE OF content ON "mem_blocks"
  FOR EACH ROW EXECUTE FUNCTION mem_blocks_search_vector_update();--> statement-breakpoint
CREATE INDEX "mem_blocks_search_vector_idx" ON "mem_blocks" USING GIN ("search_vector");--> statement-breakpoint
UPDATE "mem_blocks" SET search_vector = to_tsvector('french_unaccent', coalesce(content, ''));
