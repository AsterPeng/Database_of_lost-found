-- P2 数据库对象冒烟测试
-- 用法：psql "$TEST_DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/db/smoke-p2.sql
-- 脚本在事务中插入临时数据，结束时 ROLLBACK，不会污染数据库。

BEGIN;

\set ON_ERROR_STOP on

-- =========================================================
-- 1. 准备测试数据
-- =========================================================

INSERT INTO users (id, email, password_hash, nickname, department, role, status, profile_completed, created_at, updated_at)
VALUES
  ('u_author', 'author@test.local', 'x', '作者', '计算机学院', 'USER', 'ACTIVE', true, now() AT TIME ZONE 'UTC', now() AT TIME ZONE 'UTC'),
  ('u_claimant', 'claimant@test.local', 'x', '申请人', '数学学院', 'USER', 'ACTIVE', true, now() AT TIME ZONE 'UTC', now() AT TIME ZONE 'UTC'),
  ('u_third', 'third@test.local', 'x', '第三人', NULL, 'USER', 'ACTIVE', true, now() AT TIME ZONE 'UTC', now() AT TIME ZONE 'UTC'),
  ('u_admin', 'admin@test.local', 'x', '管理员', '信息中心', 'ADMIN', 'ACTIVE', true, now() AT TIME ZONE 'UTC', now() AT TIME ZONE 'UTC');

INSERT INTO categories (id, name, sort_order, enabled, created_at)
VALUES ('cat_test', '测试类别', 0, true, now() AT TIME ZONE 'UTC');

INSERT INTO posts (id, author_id, type, title, description, category_id, location, occurred_at, status, created_at, updated_at)
VALUES
  ('p_lost', 'u_author', 'LOST', '丢失一把钥匙', '蓝色挂绳钥匙', 'cat_test', '图书馆', now() AT TIME ZONE 'UTC', 'OPEN', now() AT TIME ZONE 'UTC', now() AT TIME ZONE 'UTC'),
  ('p_found', 'u_claimant', 'FOUND', '捡到一副眼镜', '黑框眼镜', 'cat_test', '教学楼', now() AT TIME ZONE 'UTC', 'OPEN', now() AT TIME ZONE 'UTC', now() AT TIME ZONE 'UTC');

-- 正常匹配：LOST / FOUND，作者不同
INSERT INTO matches (id, lost_post_id, found_post_id, score, detail, feedback, created_at, updated_at)
VALUES ('m_ok', 'p_lost', 'p_found', 0.8, '{}'::jsonb, 'NONE', now() AT TIME ZONE 'UTC', now() AT TIME ZONE 'UTC');

INSERT INTO claims (id, post_id, claimant_id, message, proof, contact_encrypted, contact_masked, status, escalate_at, created_at, updated_at)
VALUES
  ('cl_1', 'p_lost', 'u_claimant', '这是我的钥匙', '挂绳是蓝色的', 'enc', '139****0000', 'PENDING', (now() AT TIME ZONE 'UTC') + interval '48 hours', now() AT TIME ZONE 'UTC', now() AT TIME ZONE 'UTC'),
  ('cl_2', 'p_lost', 'u_third', '也是我的', '钥匙扣有刻字', 'enc2', '138****1111', 'PENDING', (now() AT TIME ZONE 'UTC') + interval '48 hours', now() AT TIME ZONE 'UTC', now() AT TIME ZONE 'UTC'),
  ('cl_3', 'p_found', 'u_author', '眼镜是我丢的', '镜腿有磨损', 'enc3', '137****2222', 'PENDING', (now() AT TIME ZONE 'UTC') + interval '48 hours', (now() AT TIME ZONE 'UTC'), now() AT TIME ZONE 'UTC');

-- 管理员只能审核已转交的认领，这里先标记转交
UPDATE claims
SET escalated_at = now() AT TIME ZONE 'UTC'
WHERE id = 'cl_3';

-- =========================================================
-- 2. fn_review_claim：作者通过
-- =========================================================

DO $$
DECLARE
  v_json jsonb;
  v_status text;
  v_count int;
BEGIN
  SELECT fn_review_claim('cl_1', 'u_author', 'ACCEPT', NULL) INTO v_json;

  IF NOT (v_json->>'ok')::boolean THEN
    RAISE EXCEPTION 'fn_review_claim accept failed: %', v_json;
  END IF;

  SELECT status::text INTO v_status FROM posts WHERE id = 'p_lost';
  IF v_status <> 'RESOLVED' THEN
    RAISE EXCEPTION 'post should be RESOLVED, got %', v_status;
  END IF;

  SELECT status::text INTO v_status FROM claims WHERE id = 'cl_1';
  IF v_status <> 'ACCEPTED' THEN
    RAISE EXCEPTION 'claim should be ACCEPTED, got %', v_status;
  END IF;

  SELECT status::text INTO v_status FROM claims WHERE id = 'cl_2';
  IF v_status <> 'REJECTED' THEN
    RAISE EXCEPTION 'other claim should be REJECTED, got %', v_status;
  END IF;

  SELECT count(*) INTO v_count FROM handovers WHERE claim_id = 'cl_1';
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'handover should be created once, got %', v_count;
  END IF;

  IF jsonb_array_length(v_json->'rejectedClaims') <> 1
     OR v_json->'rejectedClaims'->0->>'claimId' <> 'cl_2' THEN
    RAISE EXCEPTION 'rejectedClaims mismatch: %', v_json->'rejectedClaims';
  END IF;
END $$;

-- =========================================================
-- 3. 部分唯一索引：一条帖子最多一条 ACCEPTED
-- =========================================================

DO $$
BEGIN
  BEGIN
    INSERT INTO claims (
      id, post_id, claimant_id, message, proof, contact_encrypted, contact_masked,
      status, reviewed_by_id, reviewed_at, reviewer_role, escalate_at, created_at, updated_at
    ) VALUES (
      'cl_dup', 'p_lost', 'u_admin', '重复通过', 'x', 'enc', 'mask',
      'ACCEPTED', 'u_author', now() AT TIME ZONE 'UTC', 'OWNER',
      (now() AT TIME ZONE 'UTC'), (now() AT TIME ZONE 'UTC'), (now() AT TIME ZONE 'UTC')
    );
    RAISE EXCEPTION 'expected unique violation for second ACCEPTED claim';
  EXCEPTION WHEN unique_violation THEN
    NULL;
  END;
END $$;

-- =========================================================
-- 4. 帖子状态机触发器
-- =========================================================

DO $$
BEGIN
  BEGIN
    UPDATE posts SET status = 'OPEN' WHERE id = 'p_lost';
    RAISE EXCEPTION 'expected invalid post status transition';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;
END $$;

-- =========================================================
-- 5. 匹配一致性触发器
-- =========================================================

DO $$
BEGIN
  BEGIN
    INSERT INTO matches (id, lost_post_id, found_post_id, score, detail, created_at, updated_at)
    VALUES ('m_bad', 'p_found', 'p_lost', 0.5, '{}'::jsonb, now() AT TIME ZONE 'UTC', now() AT TIME ZONE 'UTC');
    RAISE EXCEPTION 'expected match integrity violation';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;
END $$;

-- =========================================================
-- 6. 认领审计触发器
-- =========================================================

DO $$
DECLARE
  v_json jsonb;
  v_count int;
  v_decision text;
BEGIN
  SELECT fn_review_claim('cl_3', 'u_admin', 'REJECT', '凭证不符') INTO v_json;

  IF NOT (v_json->>'ok')::boolean THEN
    RAISE EXCEPTION 'admin reject failed: %', v_json;
  END IF;

  SELECT count(*) INTO v_count
  FROM audit_logs
  WHERE target_type = 'CLAIM' AND target_id = 'cl_3';
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'admin claim audit should be exactly 1, got %', v_count;
  END IF;

  SELECT detail->>'decision' INTO v_decision
  FROM audit_logs
  WHERE target_type = 'CLAIM' AND target_id = 'cl_3';
  IF v_decision <> 'REJECT' THEN
    RAISE EXCEPTION 'audit decision mismatch: %', v_decision;
  END IF;

  -- 作者审核与自动拒绝不应产生管理日志
  SELECT count(*) INTO v_count
  FROM audit_logs
  WHERE target_type = 'CLAIM' AND target_id IN ('cl_1', 'cl_2');
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'owner/cascade review should not write audit, got %', v_count;
  END IF;
END $$;

-- =========================================================
-- 7. 超时转交函数
-- =========================================================

INSERT INTO claims (id, post_id, claimant_id, message, proof, contact_encrypted, contact_masked, status, escalate_at, created_at, updated_at)
VALUES (
  'cl_5', 'p_found', 'u_third', '我也丢了眼镜', '镜盒有名字', 'enc5', '136****3333',
  'PENDING', (now() AT TIME ZONE 'UTC') - interval '1 hour',
  (now() AT TIME ZONE 'UTC'), (now() AT TIME ZONE 'UTC')
);

DO $$
DECLARE
  v_json jsonb;
  v_escalated timestamp;
BEGIN
  SELECT fn_escalate_overdue_claims() INTO v_json;

  IF (v_json->>'count')::int <> 1 THEN
    RAISE EXCEPTION 'expected 1 escalated claim, got %', v_json;
  END IF;

  SELECT escalated_at INTO v_escalated FROM claims WHERE id = 'cl_5';
  IF v_escalated IS NULL THEN
    RAISE EXCEPTION 'cl_5 should be escalated';
  END IF;
END $$;

-- =========================================================
-- 8. 交接完成函数（幂等）
-- =========================================================

DO $$
DECLARE
  v_json jsonb;
  v_by text;
BEGIN
  SELECT fn_complete_handover('cl_1', 'u_claimant') INTO v_json;
  IF NOT (v_json->>'ok')::boolean THEN
    RAISE EXCEPTION 'complete handover failed: %', v_json;
  END IF;

  SELECT completed_by_id INTO v_by FROM handovers WHERE claim_id = 'cl_1';
  IF v_by <> 'u_claimant' THEN
    RAISE EXCEPTION 'completed_by_id should be u_claimant, got %', v_by;
  END IF;

  SELECT fn_complete_handover('cl_1', 'u_author') INTO v_json;
  SELECT completed_by_id INTO v_by FROM handovers WHERE claim_id = 'cl_1';
  IF v_by <> 'u_claimant' THEN
    RAISE EXCEPTION 'second confirmation should not overwrite first, got %', v_by;
  END IF;
END $$;

-- =========================================================
-- 9. 统计函数与物化视图
-- =========================================================

DO $$
DECLARE
  v_json jsonb;
  v_count int;
BEGIN
  SELECT fn_stats(NULL::timestamptz, NULL::timestamptz, NULL::text) INTO v_json;

  IF (v_json->'totals'->>'users')::int <> 3 THEN
    RAISE EXCEPTION 'stats users mismatch: %', v_json->'totals';
  END IF;

  IF (v_json->'totals'->>'posts')::int <> 2 THEN
    RAISE EXCEPTION 'stats posts mismatch: %', v_json->'totals';
  END IF;

  IF (v_json->'totals'->>'resolved')::int <> 1 THEN
    RAISE EXCEPTION 'stats resolved mismatch: %', v_json->'totals';
  END IF;

  IF (v_json->'totals'->>'matches')::int <> 1 THEN
    RAISE EXCEPTION 'stats matches mismatch: %', v_json->'totals';
  END IF;

  IF (v_json->'totals'->>'claims')::int <> 4 THEN
    RAISE EXCEPTION 'stats claims mismatch: %', v_json->'totals';
  END IF;

  IF (v_json->>'recoveryRate')::int <> 50 THEN
    RAISE EXCEPTION 'stats recoveryRate mismatch: %', v_json;
  END IF;

  IF jsonb_array_length(v_json->'byDepartment') < 3 THEN
    RAISE EXCEPTION 'stats byDepartment missing rows: %', v_json->'byDepartment';
  END IF;

  IF jsonb_array_length(v_json->'byCategory') <> 1 THEN
    RAISE EXCEPTION 'stats byCategory mismatch: %', v_json->'byCategory';
  END IF;

  PERFORM fn_refresh_stats_mv();

  SELECT count(*) INTO v_count FROM mv_stats_department;
  IF v_count < 3 THEN
    RAISE EXCEPTION 'mv_stats_department rows mismatch: %', v_count;
  END IF;

  SELECT count(*) INTO v_count FROM mv_stats_category;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'mv_stats_category rows mismatch: %', v_count;
  END IF;
END $$;

-- =========================================================
-- 10. 视图
-- =========================================================

DO $$
DECLARE
  v_count int;
  v_users int;
  v_pending int;
BEGIN
  SELECT count(*) INTO v_count FROM v_public_posts;
  IF v_count <> 2 THEN
    RAISE EXCEPTION 'v_public_posts expected 2, got %', v_count;
  END IF;

  SELECT count(*) INTO v_count FROM v_claim_detail;
  IF v_count <> 4 THEN
    RAISE EXCEPTION 'v_claim_detail expected 4, got %', v_count;
  END IF;

  SELECT count(*) INTO v_count FROM v_match_overview;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'v_match_overview expected 1, got %', v_count;
  END IF;

  SELECT count(*) INTO v_count FROM v_pending_claims;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'v_pending_claims expected 1, got %', v_count;
  END IF;

  SELECT count(*) INTO v_count FROM v_unread_notifications;
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'v_unread_notifications expected 0, got %', v_count;
  END IF;

  SELECT active_users INTO v_users FROM v_admin_dashboard;
  IF v_users <> 3 THEN
    RAISE EXCEPTION 'v_admin_dashboard active_users expected 3, got %', v_users;
  END IF;

  SELECT pending_admin_claims INTO v_pending FROM v_admin_dashboard;
  IF v_pending <> 1 THEN
    RAISE EXCEPTION 'v_admin_dashboard pending_admin_claims expected 1, got %', v_pending;
  END IF;
END $$;

\echo 'P2 数据库对象冒烟测试全部通过'

ROLLBACK;