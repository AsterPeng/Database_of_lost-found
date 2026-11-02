-- 关键词模糊检索：pg_trgm 提供三元组索引，让 ILIKE '%关键词%' 也能走索引。
-- pg_trgm 在 PostgreSQL 中属于可信扩展，数据库属主即可创建。
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS posts_title_trgm_idx ON posts USING gin (title gin_trgm_ops);
CREATE INDEX IF NOT EXISTS posts_description_trgm_idx ON posts USING gin (description gin_trgm_ops);
CREATE INDEX IF NOT EXISTS posts_location_trgm_idx ON posts USING gin (location gin_trgm_ops);
