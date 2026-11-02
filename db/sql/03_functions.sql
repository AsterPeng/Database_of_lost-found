-- P2 数据库课程化改造：存储过程与函数
-- 约定：
--   * 业务失败返回 jsonb {ok:false, code, message}，不抛异常；
--   * 所有时间写入 UTC，与 Prisma 的 timestamp(3) WITHOUT TIME ZONE 保持一致；
--   * 函数默认 SECURITY INVOKER，调用者权限决定可访问范围；
--   * 生成的主键使用 gen_random_uuid()::text（PostgreSQL 13+ 内置）。

SET search_path = public;

-- =========================================================
-- 1. fn_review_claim：认领审核（行锁 + 级联 + 原子事务）
-- =========================================================

CREATE OR REPLACE FUNCTION fn_review_claim(
  p_claim_id text,
  p_reviewer_id text,
  p_decision text,
  p_note text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_claim claims%ROWTYPE;
  v_post posts%ROWTYPE;
  v_reviewer users%ROWTYPE;
  v_role text;
  v_decision text := upper(coalesce(p_decision, ''));
  v_now timestamp(3) := (now() AT TIME ZONE 'UTC');
  v_rejected jsonb := '[]'::jsonb;
BEGIN
  -- 先锁认领，再锁帖子，固定顺序降低死锁概率
  SELECT * INTO v_claim FROM claims WHERE id = p_claim_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'code', 'CLAIM_NOT_FOUND');
  END IF;

  IF v_claim.status <> 'PENDING' THEN
    RETURN jsonb_build_object('ok', false, 'code', 'CLAIM_NOT_PENDING');
  END IF;

  SELECT * INTO v_post FROM posts WHERE id = v_claim.post_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'code', 'POST_NOT_FOUND');
  END IF;

  SELECT * INTO v_reviewer FROM users WHERE id = p_reviewer_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'code', 'FORBIDDEN');
  END IF;

  -- 帖子作者可以直接审核；管理员只能审核已超时转交的认领
  IF v_reviewer.id = v_post.author_id THEN
    v_role := 'OWNER';
  ELSIF v_reviewer.role = 'ADMIN' AND v_claim.escalated_at IS NOT NULL THEN
    v_role := 'ADMIN';
  ELSE
    RETURN jsonb_build_object('ok', false, 'code', 'FORBIDDEN');
  END IF;

  IF v_decision = 'REJECT' THEN
    UPDATE claims
    SET status = 'REJECTED',
        review_note = NULLIF(p_note, ''),
        reviewed_by_id = p_reviewer_id,
        reviewed_at = v_now,
        reviewer_role = v_role,
        updated_at = v_now
    WHERE id = p_claim_id;

    RETURN jsonb_build_object(
      'ok', true,
      'status', 'REJECTED',
      'reviewerRole', v_role,
      'claimantId', v_claim.claimant_id,
      'postId', v_post.id,
      'postTitle', v_post.title,
      'rejectedClaims', '[]'::jsonb
    );
  END IF;

  IF v_decision <> 'ACCEPT' THEN
    RETURN jsonb_build_object('ok', false, 'code', 'INVALID_DECISION');
  END IF;

  IF v_post.status <> 'OPEN'
     OR v_post.deleted_at IS NOT NULL
     OR v_post.taken_down_at IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'POST_NOT_OPEN');
  END IF;

  -- 先占用帖子状态；条件更新保证并发下只有一个事务能成功
  UPDATE posts
  SET status = 'RESOLVED',
      resolved_at = v_now,
      updated_at = v_now
  WHERE id = v_post.id
    AND status = 'OPEN'
    AND deleted_at IS NULL
    AND taken_down_at IS NULL;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'code', 'POST_NOT_OPEN');
  END IF;

  UPDATE claims
  SET status = 'ACCEPTED',
      review_note = NULLIF(p_note, ''),
      reviewed_by_id = p_reviewer_id,
      reviewed_at = v_now,
      reviewer_role = v_role,
      updated_at = v_now
  WHERE id = p_claim_id;

  -- 收集同帖其他待审申请，供应用层发送“已被他人认领”的通知
  SELECT COALESCE(
           jsonb_agg(jsonb_build_object('claimId', id, 'claimantId', claimant_id)),
           '[]'::jsonb
         )
  INTO v_rejected
  FROM claims
  WHERE post_id = v_post.id
    AND id <> p_claim_id
    AND status = 'PENDING';

  UPDATE claims
  SET status = 'REJECTED',
      review_note = '该物品已被其他申请人认领',
      reviewed_by_id = p_reviewer_id,
      reviewed_at = v_now,
      reviewer_role = v_role,
      updated_at = v_now
  WHERE post_id = v_post.id
    AND id <> p_claim_id
    AND status = 'PENDING';

  INSERT INTO handovers (id, claim_id, created_at, updated_at)
  VALUES (gen_random_uuid()::text, p_claim_id, v_now, v_now)
  ON CONFLICT (claim_id) DO NOTHING;

  RETURN jsonb_build_object(
    'ok', true,
    'status', 'ACCEPTED',
    'reviewerRole', v_role,
    'claimantId', v_claim.claimant_id,
    'postId', v_post.id,
    'postTitle', v_post.title,
    'rejectedClaims', v_rejected
  );
END;
$$;

COMMENT ON FUNCTION fn_review_claim(text, text, text, text)
  IS '认领审核：行锁、权限校验、帖子状态占用、同帖其他申请自动拒绝、创建交接记录';

-- =========================================================
-- 2. fn_escalate_overdue_claims：超时批量转交
-- =========================================================

CREATE OR REPLACE FUNCTION fn_escalate_overdue_claims()
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_now timestamp(3) := (now() AT TIME ZONE 'UTC');
  v_rec record;
  v_items jsonb := '[]'::jsonb;
  v_count int := 0;
BEGIN
  FOR v_rec IN
    SELECT
      c.id AS claim_id,
      c.post_id,
      p.title AS post_title,
      c.claimant_id
    FROM claims c
    JOIN posts p ON p.id = c.post_id
    WHERE c.status = 'PENDING'
      AND c.escalated_at IS NULL
      AND c.escalate_at <= v_now
    ORDER BY c.escalate_at
    FOR UPDATE OF c SKIP LOCKED
  LOOP
    UPDATE claims
    SET escalated_at = v_now,
        updated_at = v_now
    WHERE id = v_rec.claim_id;

    v_items := v_items || jsonb_build_array(
      jsonb_build_object(
        'claimId', v_rec.claim_id,
        'postId', v_rec.post_id,
        'postTitle', v_rec.post_title,
        'claimantId', v_rec.claimant_id
      )
    );
    v_count := v_count + 1;
  END LOOP;

  RETURN jsonb_build_object('count', v_count, 'claims', v_items);
END;
$$;

COMMENT ON FUNCTION fn_escalate_overdue_claims()
  IS '批量把超时未处理的 PENDING 认领标记为已转交管理员，返回受影响的认领列表';

-- =========================================================
-- 3. fn_complete_handover：确认交接完成（幂等）
-- =========================================================

CREATE OR REPLACE FUNCTION fn_complete_handover(
  p_claim_id text,
  p_user_id text
) RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_claim claims%ROWTYPE;
  v_post posts%ROWTYPE;
  v_now timestamp(3) := (now() AT TIME ZONE 'UTC');
  v_handover handovers%ROWTYPE;
BEGIN
  SELECT * INTO v_claim FROM claims WHERE id = p_claim_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'code', 'CLAIM_NOT_FOUND');
  END IF;

  IF v_claim.status <> 'ACCEPTED' THEN
    RETURN jsonb_build_object('ok', false, 'code', 'HANDOVER_NOT_ALLOWED');
  END IF;

  SELECT * INTO v_post FROM posts WHERE id = v_claim.post_id;
  IF NOT (p_user_id = v_claim.claimant_id OR p_user_id = v_post.author_id) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'FORBIDDEN');
  END IF;

  INSERT INTO handovers (id, claim_id, completed_at, completed_by_id, created_at, updated_at)
  VALUES (gen_random_uuid()::text, p_claim_id, v_now, p_user_id, v_now, v_now)
  ON CONFLICT (claim_id) DO UPDATE
  SET completed_at = COALESCE(handovers.completed_at, EXCLUDED.completed_at),
      completed_by_id = COALESCE(handovers.completed_by_id, EXCLUDED.completed_by_id),
      updated_at = v_now
  RETURNING * INTO v_handover;

  RETURN jsonb_build_object(
    'ok', true,
    'completedAt', v_handover.completed_at,
    'completedById', v_handover.completed_by_id
  );
END;
$$;

COMMENT ON FUNCTION fn_complete_handover(text, text)
  IS '确认线下交接完成；重复调用不会覆盖首次完成时间与确认人';

-- =========================================================
-- 4. fn_stats：统计下推
-- =========================================================

CREATE OR REPLACE FUNCTION fn_stats(
  p_since timestamptz DEFAULT NULL,
  p_until timestamptz DEFAULT NULL,
  p_department text DEFAULT NULL
) RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
WITH params AS (
  SELECT
    (p_since AT TIME ZONE 'UTC') AS since_ts,
    (COALESCE(p_until, now()) AT TIME ZONE 'UTC') AS until_ts,
    NULLIF(p_department, '') AS dept
),
user_scope AS (
  SELECT u.*
  FROM users u
  CROSS JOIN params pa
  WHERE u.role = 'USER'
    AND u.status = 'ACTIVE'
    AND (pa.dept IS NULL OR u.department = pa.dept)
),
new_user_scope AS (
  SELECT u.*
  FROM users u
  CROSS JOIN params pa
  WHERE u.role = 'USER'
    AND (pa.since_ts IS NULL OR u.created_at >= pa.since_ts)
    AND u.created_at <= pa.until_ts
    AND (pa.dept IS NULL OR u.department = pa.dept)
),
post_scope AS (
  SELECT
    p.*,
    u.department AS author_department,
    c.name AS category_name
  FROM posts p
  JOIN users u ON u.id = p.author_id
  JOIN categories c ON c.id = p.category_id
  CROSS JOIN params pa
  WHERE p.deleted_at IS NULL
    AND (pa.since_ts IS NULL OR p.created_at >= pa.since_ts)
    AND p.created_at <= pa.until_ts
    AND (pa.dept IS NULL OR u.department = pa.dept)
),
match_count AS (
  SELECT count(*)::int AS n
  FROM matches m
  JOIN posts lp ON lp.id = m.lost_post_id
  JOIN posts fp ON fp.id = m.found_post_id
  JOIN users lu ON lu.id = lp.author_id
  JOIN users fu ON fu.id = fp.author_id
  CROSS JOIN params pa
  WHERE lp.deleted_at IS NULL
    AND fp.deleted_at IS NULL
    AND (pa.since_ts IS NULL OR m.created_at >= pa.since_ts)
    AND m.created_at <= pa.until_ts
    AND (pa.dept IS NULL OR lu.department = pa.dept OR fu.department = pa.dept)
),
claim_count AS (
  SELECT count(*)::int AS n
  FROM claims c
  JOIN posts p ON p.id = c.post_id
  JOIN users pu ON pu.id = p.author_id
  JOIN users cu ON cu.id = c.claimant_id
  CROSS JOIN params pa
  WHERE p.deleted_at IS NULL
    AND (pa.since_ts IS NULL OR c.created_at >= pa.since_ts)
    AND c.created_at <= pa.until_ts
    AND (pa.dept IS NULL OR pu.department = pa.dept OR cu.department = pa.dept)
),
department_posts AS (
  SELECT
    COALESCE(author_department, '未填写') AS department,
    count(*)::int AS posts,
    count(*) FILTER (WHERE status = 'RESOLVED')::int AS resolved
  FROM post_scope
  GROUP BY 1
),
department_users AS (
  SELECT
    COALESCE(department, '未填写') AS department,
    count(*)::int AS users
  FROM user_scope
  GROUP BY 1
),
department_rows AS (
  SELECT
    COALESCE(du.department, dp.department) AS department,
    COALESCE(du.users, 0) AS users,
    COALESCE(dp.posts, 0) AS posts,
    COALESCE(dp.resolved, 0) AS resolved,
    CASE
      WHEN COALESCE(dp.posts, 0) = 0 THEN 0
      ELSE round(COALESCE(dp.resolved, 0)::numeric / dp.posts * 100)::int
    END AS recovery_rate
  FROM department_users du
  FULL JOIN department_posts dp ON dp.department = du.department
),
category_rows AS (
  SELECT
    category_name AS category,
    count(*)::int AS posts,
    count(*) FILTER (WHERE status = 'RESOLVED')::int AS resolved
  FROM post_scope
  GROUP BY 1
),
departments_list AS (
  SELECT DISTINCT department
  FROM users
  WHERE role = 'USER' AND department IS NOT NULL
),
post_totals AS (
  SELECT
    count(*)::int AS posts,
    count(*) FILTER (WHERE status = 'RESOLVED')::int AS resolved,
    count(*) FILTER (WHERE taken_down_at IS NOT NULL)::int AS taken_down
  FROM post_scope
)
SELECT jsonb_build_object(
  'totals', jsonb_build_object(
    'users', (SELECT count(*)::int FROM user_scope),
    'newUsers', (SELECT count(*)::int FROM new_user_scope),
    'posts', (SELECT posts FROM post_totals),
    'resolved', (SELECT resolved FROM post_totals),
    'matches', (SELECT n FROM match_count),
    'claims', (SELECT n FROM claim_count),
    'takenDown', (SELECT taken_down FROM post_totals)
  ),
  'recoveryRate', CASE
    WHEN (SELECT posts FROM post_totals) = 0 THEN 0
    ELSE round((SELECT resolved FROM post_totals)::numeric / (SELECT posts FROM post_totals) * 100)::int
  END,
  'byDepartment', COALESCE((
    SELECT jsonb_agg(
      jsonb_build_object(
        'department', department,
        'users', users,
        'posts', posts,
        'resolved', resolved,
        'recoveryRate', recovery_rate
      )
      ORDER BY posts DESC, users DESC, department
    )
    FROM department_rows
  ), '[]'::jsonb),
  'byCategory', COALESCE((
    SELECT jsonb_agg(
      jsonb_build_object(
        'category', category,
        'posts', posts,
        'resolved', resolved
      )
      ORDER BY posts DESC, category
    )
    FROM category_rows
  ), '[]'::jsonb),
  'departments', COALESCE((
    SELECT jsonb_agg(department ORDER BY department)
    FROM departments_list
  ), '[]'::jsonb)
);
$$;

COMMENT ON FUNCTION fn_stats(timestamptz, timestamptz, text)
  IS '统计报表：用户、发布、匹配、认领、院系与类别汇总，口径与 src/lib/stats.ts 保持一致';