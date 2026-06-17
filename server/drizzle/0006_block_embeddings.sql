-- Embeddings par bloc (issue #10) — hors DSL Drizzle, comme search_vector (0001).
-- Modèle versionné par ligne : re-vectorisation possible au changement de modèle.
-- NULL = pas encore vectorisé (API down à l'écriture, ou antérieur au backfill) ;
-- les requêtes kNN ignorent les NULL — dégradation propre, pas de fallback caché.
CREATE EXTENSION IF NOT EXISTS vector;

ALTER TABLE mem_blocks ADD COLUMN IF NOT EXISTS embedding vector(1536);
ALTER TABLE mem_blocks ADD COLUMN IF NOT EXISTS embedding_model text;

-- HNSW cosine : bon rappel sans tuning, index vivant (pas de re-build comme ivfflat).
CREATE INDEX IF NOT EXISTS mem_blocks_embedding_idx
  ON mem_blocks USING hnsw (embedding vector_cosine_ops);
