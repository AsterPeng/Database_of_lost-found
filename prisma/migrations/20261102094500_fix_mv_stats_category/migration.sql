-- 修正类别物化视图口径：只统计有帖子的类别，与 fn_stats.byCategory 和应用层报表一致。
DROP MATERIALIZED VIEW IF EXISTS mv_stats_category;

CREATE MATERIALIZED VIEW mv_stats_category AS
SELECT
  c.name AS category,
  count(*)::int AS posts,
  count(*) FILTER (WHERE p.status = 'RESOLVED')::int AS resolved,
  CASE
    WHEN count(*) = 0 THEN 0
    ELSE round(
      count(*) FILTER (WHERE p.status = 'RESOLVED')::numeric / count(*) * 100
    )::int
  END AS recovery_rate
FROM posts p
JOIN categories c ON c.id = p.category_id
WHERE p.deleted_at IS NULL
GROUP BY c.name;

CREATE UNIQUE INDEX mv_stats_category_key
  ON mv_stats_category (category);