-- P2 数据库课程化改造：物化视图、刷新函数与触发器

-- =========================================================
-- 1. 院系统计物化视图
-- =========================================================

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

COMMENT ON MATERIALIZED VIEW mv_stats_department
  IS '全部时间的院系统计快照；由 fn_refresh_stats_mv() 刷新';

-- =========================================================
-- 2. 类别统计物化视图
-- =========================================================

CREATE MATERIALIZED VIEW IF NOT EXISTS mv_stats_category AS
SELECT
  c.name AS category,
  count(p.id)::int AS posts,
  count(p.id) FILTER (WHERE p.status = 'RESOLVED')::int AS resolved,
  CASE
    WHEN count(p.id) = 0 THEN 0
    ELSE round(
      count(p.id) FILTER (WHERE p.status = 'RESOLVED')::numeric / count(p.id) * 100
    )::int
  END AS recovery_rate
FROM categories c
LEFT JOIN posts p ON p.category_id = c.id AND p.deleted_at IS NULL
GROUP BY c.name;

CREATE UNIQUE INDEX IF NOT EXISTS mv_stats_category_key
  ON mv_stats_category (category);

COMMENT ON MATERIALIZED VIEW mv_stats_category
  IS '全部时间的类别统计快照；由 fn_refresh_stats_mv() 刷新';

-- =========================================================
-- 3. 物化视图刷新函数
-- =========================================================

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

COMMENT ON FUNCTION fn_refresh_stats_mv()
  IS '刷新院系与类别统计物化视图；后续可改为 CONCURRENTLY 以降低锁粒度';

-- =========================================================
-- 4. 帖子状态机触发器
-- =========================================================

CREATE OR REPLACE FUNCTION fn_post_status_transition()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF NOT (OLD.status = 'OPEN' AND NEW.status IN ('RESOLVED', 'CLOSED')) THEN
      RAISE EXCEPTION 'invalid post status transition: % -> %', OLD.status, NEW.status
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_post_status_transition ON posts;
CREATE TRIGGER trg_post_status_transition
  BEFORE UPDATE OF status ON posts
  FOR EACH ROW
  EXECUTE FUNCTION fn_post_status_transition();

COMMENT ON FUNCTION fn_post_status_transition()
  IS '帖子状态机：只允许 OPEN -> RESOLVED 或 OPEN -> CLOSED';

-- =========================================================
-- 5. 匹配一致性触发器
-- =========================================================

CREATE OR REPLACE FUNCTION fn_match_integrity()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_lost_type posts.type%TYPE;
  v_lost_author text;
  v_found_type posts.type%TYPE;
  v_found_author text;
BEGIN
  IF NEW.lost_post_id = NEW.found_post_id THEN
    RAISE EXCEPTION 'match cannot pair a post with itself'
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT type, author_id INTO v_lost_type, v_lost_author
  FROM posts WHERE id = NEW.lost_post_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'lost post % does not exist', NEW.lost_post_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  SELECT type, author_id INTO v_found_type, v_found_author
  FROM posts WHERE id = NEW.found_post_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'found post % does not exist', NEW.found_post_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  IF v_lost_type <> 'LOST' OR v_found_type <> 'FOUND' THEN
    RAISE EXCEPTION 'match must pair LOST with FOUND (got % / %)', v_lost_type, v_found_type
      USING ERRCODE = 'check_violation';
  END IF;

  IF v_lost_author = v_found_author THEN
    RAISE EXCEPTION 'match cannot pair posts by the same author'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_match_integrity ON matches;
CREATE TRIGGER trg_match_integrity
  BEFORE INSERT OR UPDATE ON matches
  FOR EACH ROW
  EXECUTE FUNCTION fn_match_integrity();

COMMENT ON FUNCTION fn_match_integrity()
  IS '匹配一致性：一端 LOST、一端 FOUND，不能自匹配或匹配同一作者';

-- =========================================================
-- 6. 认领审核审计触发器
-- =========================================================

CREATE OR REPLACE FUNCTION fn_claim_audit()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_title text;
BEGIN
  IF OLD.status = 'PENDING'
     AND NEW.status IN ('ACCEPTED', 'REJECTED')
     AND NEW.reviewer_role = 'ADMIN'
     -- 同帖其他申请被自动拒绝属于级联结果，不单独记一条管理日志
     AND COALESCE(NEW.review_note, '') <> '该物品已被其他申请人认领' THEN
    SELECT title INTO v_title FROM posts WHERE id = NEW.post_id;

    INSERT INTO audit_logs (
      id, operator_id, action, target_type, target_id, detail, created_at
    ) VALUES (
      gen_random_uuid()::text,
      NEW.reviewed_by_id,
      'CLAIM_REVIEW',
      'CLAIM',
      NEW.id,
      jsonb_build_object(
        'title', COALESCE(v_title, ''),
        'decision', NEW.status::text,
        'note', NEW.review_note
      ),
      (now() AT TIME ZONE 'UTC')
    );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_claim_audit ON claims;
CREATE TRIGGER trg_claim_audit
  AFTER UPDATE OF status ON claims
  FOR EACH ROW
  EXECUTE FUNCTION fn_claim_audit();

COMMENT ON FUNCTION fn_claim_audit()
  IS '管理员审核认领时写入 audit_logs；作者审核与级联自动拒绝不写管理日志';