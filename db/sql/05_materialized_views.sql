-- =========================================================
-- 校园失物招领平台 数据库课程设计
-- 05 物化视图与刷新函数（P2 最终版本）
-- =========================================================

SET search_path = public;

-- ---------------------------------------------------------
-- 1. 院系统计物化视图
-- ---------------------------------------------------------

CREATE MATERIALIZED VIEW IF NOT EXISTS mv_stats_department AS
WITH user_counts AS (
  SELECT
    COALESCE(department, '未填写') AS department,
    count(*)::int AS users
  FROM users
  WHERE role = 'USER' AND status = 'ACTIVE'
  GROUP BY 1
),
post_counts AS (
  SELECT
    COALESCE(u.department, '未填写') AS department,
    count(*)::int AS posts,
    count(*) FILTER (WHERE p.status = 'RESOLVED')::int AS resolved
  FROM posts p
  JOIN users u ON u.id = p.author_id
  WHERE p.deleted_at IS NULL
  GROUP BY 1
)
SELECT
  COALESCE(uc.department, pc.department) AS department,
  COALESCE(uc.users, 0) AS users,
  COALESCE(pc.posts, 0) AS posts,
  COALESCE(pc.resolved, 0) AS resolved,
  CASE
    WHEN COALESCE(pc.posts, 0) = 0 THEN 0
    ELSE round(COALESCE(pc.resolved, 0)::numeric / pc.posts * 100)::int
  END AS recovery_rate
FROM user_counts uc
FULL JOIN post_counts pc ON pc.department = uc.department;

CREATE UNIQUE INDEX IF NOT EXISTS mv_stats_department_key
  ON mv_stats_department (department);

-- ---------------------------------------------------------
-- 2. 类别统计物化视图（只统计有帖子的类别）
-- ---------------------------------------------------------

CREATE MATERIALIZED VIEW IF NOT EXISTS mv_stats_category AS
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

CREATE UNIQUE INDEX IF NOT EXISTS mv_stats_category_key
  ON mv_stats_category (category);

-- ---------------------------------------------------------
-- 3. 刷新函数
-- ---------------------------------------------------------

CREATE OR REPLACE FUNCTION fn_refresh_stats_mv()
RETURNS void
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  REFRESH MATERIALIZED VIEW mv_stats_department;
  REFRESH MATERIALIZED VIEW mv_stats_category;
END;
$$;

COMMENT ON MATERIALIZED VIEW mv_stats_department
  IS '全部时间的院系统计快照；由 fn_refresh_stats_mv() 刷新';
COMMENT ON MATERIALIZED VIEW mv_stats_category
  IS '全部时间的类别统计快照（只含有帖子的类别）；由 fn_refresh_stats_mv() 刷新';
COMMENT ON FUNCTION fn_refresh_stats_mv()
  IS '刷新院系与类别统计物化视图；后续可改为 CONCURRENTLY 以降低锁粒度';