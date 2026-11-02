-- =========================================================
-- 校园失物招领平台 数据库课程设计
-- 01 约束与索引（P2 最终版本）
-- 说明：
--   * 本文件等价于 Prisma 迁移
--     20261102090000_db_course_constraints_indexes
--     与 20261102094000_relax_claim_handover_checks 的最终状态；
--   * 可在已完成 P1 基线结构的数据库上执行；
--   * 执行前请备份，并确认没有违反约束的历史数据。
-- =========================================================

SET search_path = public;

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ---------------------------------------------------------
-- 1. 外键补齐
-- ---------------------------------------------------------

ALTER TABLE claims
  ADD CONSTRAINT claims_match_id_fkey
  FOREIGN KEY (match_id) REFERENCES matches(id) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE handovers
  ADD CONSTRAINT handovers_proposed_by_id_fkey
  FOREIGN KEY (proposed_by_id) REFERENCES users(id) ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT handovers_completed_by_id_fkey
  FOREIGN KEY (completed_by_id) REFERENCES users(id) ON DELETE SET NULL ON UPDATE CASCADE;

-- ---------------------------------------------------------
-- 2. CHECK 约束
-- ---------------------------------------------------------

ALTER TABLE matches
  ADD CONSTRAINT matches_score_check CHECK (score >= 0 AND score <= 1),
  ADD CONSTRAINT matches_pair_check CHECK (lost_post_id <> found_post_id);

ALTER TABLE notification_preferences
  ADD CONSTRAINT notification_preferences_quiet_check
  CHECK (quiet_start BETWEEN 0 AND 23 AND quiet_end BETWEEN 0 AND 23);

ALTER TABLE announcements
  ADD CONSTRAINT announcements_expiry_check
  CHECK (expires_at IS NULL OR expires_at > published_at);

ALTER TABLE post_images
  ADD CONSTRAINT post_images_size_check CHECK (size > 0);

ALTER TABLE post_embeddings
  ADD CONSTRAINT post_embeddings_dim_check
  CHECK (dim > 0 AND dim = array_length(vector, 1));

ALTER TABLE reports
  ADD CONSTRAINT reports_target_type_check CHECK (target_type IN ('POST'));

ALTER TABLE audit_logs
  ADD CONSTRAINT audit_logs_target_type_check
  CHECK (target_type IN ('POST', 'USER', 'CLAIM', 'CATEGORY', 'CONFIG'));

ALTER TABLE claims
  ADD CONSTRAINT claims_reviewer_role_check
  CHECK (reviewer_role IS NULL OR reviewer_role IN ('OWNER', 'ADMIN'));

-- 删除审核人时 reviewed_by_id 会被置空，因此这里只约束“有完成时间时允许确认人为空”
ALTER TABLE handovers
  ADD CONSTRAINT handovers_completion_check
  CHECK (completed_at IS NOT NULL OR completed_by_id IS NULL);

ALTER TABLE posts
  ADD CONSTRAINT posts_resolved_check
  CHECK (status <> 'RESOLVED' OR resolved_at IS NOT NULL);

-- ---------------------------------------------------------
-- 3. 唯一约束与部分唯一索引
-- ---------------------------------------------------------

CREATE UNIQUE INDEX post_images_post_sort_key
  ON post_images (post_id, sort_order);

CREATE UNIQUE INDEX claims_one_accepted_per_post
  ON claims (post_id)
  WHERE status = 'ACCEPTED';

-- ---------------------------------------------------------
-- 4. 查询与统计索引
-- ---------------------------------------------------------

CREATE INDEX posts_public_feed_idx
  ON posts (type, created_at DESC)
  WHERE deleted_at IS NULL AND taken_down_at IS NULL AND archived_at IS NULL;

CREATE INDEX posts_public_category_idx
  ON posts (category_id, created_at DESC)
  WHERE deleted_at IS NULL AND taken_down_at IS NULL AND archived_at IS NULL;

CREATE INDEX claims_pending_escalate_idx
  ON claims (escalate_at)
  WHERE status = 'PENDING' AND escalated_at IS NULL;

CREATE INDEX notifications_unread_idx
  ON notifications (user_id)
  WHERE read_at IS NULL;

CREATE INDEX matches_created_at_idx ON matches (created_at);
CREATE INDEX claims_created_at_idx ON claims (created_at);
CREATE INDEX users_department_idx ON users (department) WHERE role = 'USER';

CREATE INDEX posts_title_trgm_idx ON posts USING gin (title gin_trgm_ops);
CREATE INDEX posts_description_trgm_idx ON posts USING gin (description gin_trgm_ops);
CREATE INDEX posts_location_trgm_idx ON posts USING gin (location gin_trgm_ops);

ANALYZE posts;
ANALYZE claims;
ANALYZE matches;
ANALYZE notifications;
ANALYZE users;
ANALYZE post_images;
ANALYZE post_embeddings;
ANALYZE reports;
ANALYZE audit_logs;
ANALYZE announcements;
ANALYZE notification_preferences;
ANALYZE handovers;