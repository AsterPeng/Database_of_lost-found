-- =========================================================
-- 校园失物招领平台 数据库课程设计
-- 08 答辩演示查询（P8）
--
-- 建议在增强展示库或测试库执行；不要在原项目冻结库执行。
-- 部分查询需要先替换 :user_id 为真实用户 ID。
-- =========================================================

SET search_path = public;

-- 1. 数据库对象总览
SELECT viewname
FROM pg_views
WHERE schemaname = 'public' AND viewname LIKE 'v_%'
ORDER BY 1;

SELECT matviewname
FROM pg_matviews
WHERE schemaname = 'public'
ORDER BY 1;

SELECT tgname
FROM pg_trigger
WHERE NOT tgisinternal
ORDER BY 1;

SELECT proname
FROM pg_proc
WHERE pronamespace = 'public'::regnamespace
  AND proname LIKE 'fn_%'
ORDER BY 1;

-- 2. 公开帖子视图（自动排除删除、下架、归档）
SELECT id, type, title, category_name, author_nickname, created_at
FROM v_public_posts
ORDER BY created_at DESC
LIMIT 10;

-- 3. 匹配总览
SELECT match_id, lost_title, found_title, score, feedback
FROM v_match_overview
ORDER BY created_at DESC
LIMIT 10;

-- 4. 统计函数
SELECT fn_stats(NULL::timestamptz, NULL::timestamptz, NULL::text) AS all_time_stats;
SELECT fn_stats(
  (now() - interval '30 days')::timestamptz,
  now(),
  NULL::text
) AS last_30_days_stats;

-- 5. 物化视图（刷新后查询）
SELECT * FROM mv_stats_department ORDER BY posts DESC, users DESC;
SELECT * FROM mv_stats_category ORDER BY posts DESC;

-- 6. RLS 演示：把 :user_id 替换为真实用户 ID 后执行
-- BEGIN;
-- SET LOCAL ROLE clfp_rls_demo;
-- SELECT set_config('app.current_user_id', ':user_id', true);
-- SELECT id, title, read_at FROM notifications;
-- SELECT id, post_id, status FROM claims;
-- SELECT id, claim_id, grantor_id, grantee_id FROM contact_grants;
-- RESET ROLE;
-- COMMIT;

-- 7. 列级权限演示：统计角色看不到敏感列（预期报 42501，单独执行）
-- BEGIN;
-- SET LOCAL ROLE clfp_stats;
-- SELECT phone_encrypted FROM users LIMIT 1;
-- ROLLBACK;

-- 8. 认领审核函数（演示时建议在测试库执行，替换真实 ID）
-- SELECT fn_review_claim(
--   'claim_id_here'::text,
--   'reviewer_user_id_here'::text,
--   'ACCEPT'::text,
--   '凭证核对无误'::text
-- );