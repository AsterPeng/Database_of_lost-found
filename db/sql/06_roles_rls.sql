-- =========================================================
-- 校园失物招领平台 数据库课程设计
-- 06 角色、授权与行级安全（P4）
--
-- 执行要求：
--   * 创建角色需要 CREATEROLE 或超级用户权限；
--   * 授权与 RLS 需要对象属主（本项目为 clfp）或超级用户；
--   * 请在 clfp_enhanced 与 clfp_test 两个库分别执行；
--   * 不要对 clfp_original（原项目冻结库）执行。
--
-- 推荐执行方式（临时给 clfp 建角色权限后）：
--   ALTER ROLE clfp CREATEROLE;          -- 由 postgres 执行一次
--   psql "$DATABASE_URL" -f db/sql/06_roles_rls.sql
--   ALTER ROLE clfp NOCREATEROLE;        -- 完成后收回
-- =========================================================

SET search_path = public;

-- ---------------------------------------------------------
-- 1. 角色
-- ---------------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'clfp_owner') THEN
    EXECUTE 'CREATE ROLE clfp_owner NOLOGIN';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'clfp_app') THEN
    EXECUTE 'CREATE ROLE clfp_app NOLOGIN';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'clfp_stats') THEN
    EXECUTE 'CREATE ROLE clfp_stats NOLOGIN';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'clfp_readonly') THEN
    EXECUTE 'CREATE ROLE clfp_readonly NOLOGIN';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'clfp_rls_demo') THEN
    EXECUTE 'CREATE ROLE clfp_rls_demo NOLOGIN';
  END IF;
END
$$;

-- 让开发账号 clfp 可以通过 SET ROLE 演示；生产环境应使用独立的登录角色
GRANT clfp_owner, clfp_app, clfp_stats, clfp_readonly, clfp_rls_demo TO clfp;

GRANT USAGE ON SCHEMA public
  TO clfp_owner, clfp_app, clfp_stats, clfp_readonly, clfp_rls_demo;

-- ---------------------------------------------------------
-- 2. clfp_owner：运维/DDL 角色
--    实际对象属主仍是 clfp，以保证 Prisma 迁移可执行
-- ---------------------------------------------------------

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO clfp_owner;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO clfp_owner;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO clfp_owner;
GRANT CREATE ON SCHEMA public TO clfp_owner;

-- ---------------------------------------------------------
-- 3. clfp_app：应用 DML 角色，无 DDL
-- ---------------------------------------------------------

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO clfp_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO clfp_app;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO clfp_app;

-- 应用角色不需要主动刷新统计物化视图
REVOKE EXECUTE ON FUNCTION fn_refresh_stats_mv() FROM clfp_app;

-- Prisma 迁移表不对业务角色开放
REVOKE ALL ON TABLE _prisma_migrations
  FROM clfp_owner, clfp_app, clfp_stats, clfp_readonly, clfp_rls_demo;

-- ---------------------------------------------------------
-- 4. clfp_stats：统计角色，只读视图/物化视图 + 列级基础表 + fn_stats
-- ---------------------------------------------------------

GRANT SELECT ON
  v_public_posts,
  v_match_overview,
  v_admin_dashboard,
  v_pending_claims,
  v_unread_notifications
TO clfp_stats;

GRANT SELECT ON mv_stats_department, mv_stats_category TO clfp_stats;

-- fn_stats 是 SECURITY INVOKER，因此需要这些列的 SELECT 权限；
-- 不授予 phone_encrypted、password_hash、contact_encrypted 等敏感列。
GRANT SELECT (id, role, status, department, created_at) ON users TO clfp_stats;
GRANT SELECT (id, author_id, status, deleted_at, taken_down_at, archived_at, created_at, category_id)
  ON posts TO clfp_stats;
GRANT SELECT (id, name) ON categories TO clfp_stats;
GRANT SELECT (created_at, lost_post_id, found_post_id) ON matches TO clfp_stats;
GRANT SELECT (created_at, post_id, claimant_id) ON claims TO clfp_stats;

GRANT EXECUTE ON FUNCTION fn_stats(timestamptz, timestamptz, text) TO clfp_stats;

-- ---------------------------------------------------------
-- 5. clfp_readonly：公开只读角色
-- ---------------------------------------------------------

GRANT SELECT ON v_public_posts, v_match_overview TO clfp_readonly;
GRANT SELECT (id, nickname, department) ON users TO clfp_readonly;
GRANT SELECT (id, name) ON categories TO clfp_readonly;

-- ---------------------------------------------------------
-- 6. clfp_rls_demo：RLS 演示角色，只授予必要列
-- ---------------------------------------------------------

GRANT SELECT (id, user_id, type, title, body, link, deliver_at, read_at, created_at)
  ON notifications TO clfp_rls_demo;
GRANT SELECT (id, post_id, claimant_id, status, created_at)
  ON claims TO clfp_rls_demo;
GRANT SELECT (id, claim_id, grantor_id, grantee_id, created_at, revoked_at)
  ON contact_grants TO clfp_rls_demo;
GRANT SELECT (id, author_id, type, title, status, deleted_at, taken_down_at, archived_at, created_at)
  ON posts TO clfp_rls_demo;

-- ---------------------------------------------------------
-- 7. 行级安全策略
-- ---------------------------------------------------------

ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE claims ENABLE ROW LEVEL SECURITY;
ALTER TABLE contact_grants ENABLE ROW LEVEL SECURITY;

-- 7.1 用户只能看自己的通知
DROP POLICY IF EXISTS notifications_self_select ON notifications;
CREATE POLICY notifications_self_select ON notifications
  FOR SELECT TO clfp_rls_demo
  USING (user_id = current_setting('app.current_user_id', true));

-- 7.2 认领只对申请人与帖子作者可见
DROP POLICY IF EXISTS claims_party_select ON claims;
CREATE POLICY claims_party_select ON claims
  FOR SELECT TO clfp_rls_demo
  USING (
    claimant_id = current_setting('app.current_user_id', true)
    OR EXISTS (
      SELECT 1
      FROM posts p
      WHERE p.id = claims.post_id
        AND p.author_id = current_setting('app.current_user_id', true)
    )
  );

-- 7.3 联系方式授权只对授权方与被授权方可见
DROP POLICY IF EXISTS contact_grants_party_select ON contact_grants;
CREATE POLICY contact_grants_party_select ON contact_grants
  FOR SELECT TO clfp_rls_demo
  USING (
    grantor_id = current_setting('app.current_user_id', true)
    OR grantee_id = current_setting('app.current_user_id', true)
  );

-- 7.4 统计角色需要聚合全部认领；只读，不返回敏感列
DROP POLICY IF EXISTS claims_stats_all ON claims;
CREATE POLICY claims_stats_all ON claims
  FOR SELECT TO clfp_stats
  USING (true);

-- 7.5 应用与运维角色按应用层规则访问；保留策略避免 RLS 把正常 DML 拦掉
DROP POLICY IF EXISTS notifications_app_all ON notifications;
CREATE POLICY notifications_app_all ON notifications
  FOR ALL TO clfp_app USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS claims_app_all ON claims;
CREATE POLICY claims_app_all ON claims
  FOR ALL TO clfp_app USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS contact_grants_app_all ON contact_grants;
CREATE POLICY contact_grants_app_all ON contact_grants
  FOR ALL TO clfp_app USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS notifications_owner_all ON notifications;
CREATE POLICY notifications_owner_all ON notifications
  FOR ALL TO clfp_owner USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS claims_owner_all ON claims;
CREATE POLICY claims_owner_all ON claims
  FOR ALL TO clfp_owner USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS contact_grants_owner_all ON contact_grants;
CREATE POLICY contact_grants_owner_all ON contact_grants
  FOR ALL TO clfp_owner USING (true) WITH CHECK (true);

-- ---------------------------------------------------------
-- 8. 说明
-- ---------------------------------------------------------
-- * 表属主 clfp 不受 RLS 限制（未使用 FORCE ROW LEVEL SECURITY），
--   因此现有 Prisma 应用不需要改动即可继续工作。
-- * 生产环境应创建独立登录角色并授予 clfp_app，签名连接串使用该角色；
--   若希望应用层也受 RLS 约束，需要按请求 SET LOCAL app.current_user_id，
--   并移除 *_app_all 策略，或在生产环境改用专用 RLS 角色。
-- * clfp_owner 目前是运维权限组，不是对象属主；对象属主保持 clfp，
--   以免破坏 Prisma 迁移的属主检查。