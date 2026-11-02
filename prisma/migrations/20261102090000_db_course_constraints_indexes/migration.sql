-- P2 数据库课程化改造：约束与索引
-- 1) 补齐缺失外键
-- 2) 增加用户自定义完整性 CHECK
-- 3) 增加唯一/部分唯一索引与查询索引
-- 4) 重建关键词检索所需的 pg_trgm GIN 索引
-- 执行前已校验现有数据：无悬空引用、无违反 CHECK、无重复配图顺序、无多条 ACCEPTED 认领。

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- =========================================================
-- 1. 外键补齐
-- =========================================================

ALTER TABLE claims
  ADD CONSTRAINT claims_match_id_fkey
  FOREIGN KEY (match_id) REFERENCES matches(id) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE handovers
  ADD CONSTRAINT handovers_proposed_by_id_fkey
  FOREIGN KEY (proposed_by_id) REFERENCES users(id) ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT handovers_completed_by_id_fkey
  FOREIGN KEY (completed_by_id) REFERENCES users(id) ON DELETE SET NULL ON UPDATE CASCADE;

-- =========================================================
-- 2. CHECK 约束
-- =========================================================

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
  CHECK (reviewer_role IS NULL OR reviewer_role IN ('OWNER', 'ADMIN')),
  ADD CONSTRAINT claims_review_consistency_check
  CHECK (
    (status IN ('ACCEPTED', 'REJECTED')
      AND reviewed_by_id IS NOT NULL
      AND reviewed_at IS NOT NULL
      AND reviewer_role IS NOT NULL)
    OR status NOT IN ('ACCEPTED', 'REJECTED')
  );

ALTER TABLE handovers
  ADD CONSTRAINT handovers_completion_check
  CHECK (
    (completed_at IS NULL AND completed_by_id IS NULL)
    OR (completed_at IS NOT NULL AND completed_by_id IS NOT NULL)
  );

ALTER TABLE posts
  ADD CONSTRAINT posts_resolved_check
  CHECK (status <> 'RESOLVED' OR resolved_at IS NOT NULL);

-- =========================================================
-- 3. 唯一约束与部分唯一索引
-- =========================================================

-- 同一帖子的配图顺序必须唯一，避免展示顺序不稳定
CREATE UNIQUE INDEX post_images_post_sort_key
  ON post_images (post_id, sort_order);

-- 一条帖子最多只能有一条通过的认领
CREATE UNIQUE INDEX claims_one_accepted_per_post
  ON claims (post_id)
  WHERE status = 'ACCEPTED';

-- =========================================================
-- 4. 查询与统计索引
-- =========================================================

-- 公开信息流：排除删除、下架、归档后，按类型 + 时间
CREATE INDEX posts_public_feed_idx
  ON posts (type, created_at DESC)
  WHERE deleted_at IS NULL AND taken_down_at IS NULL AND archived_at IS NULL;

-- 公开信息流：按类别 + 时间
CREATE INDEX posts_public_category_idx
  ON posts (category_id, created_at DESC)
  WHERE deleted_at IS NULL AND taken_down_at IS NULL AND archived_at IS NULL;

-- 超时转交只扫描待处理且未转交的认领
CREATE INDEX claims_pending_escalate_idx
  ON claims (escalate_at)
  WHERE status = 'PENDING' AND escalated_at IS NULL;

-- 未读通知角标
CREATE INDEX notifications_unread_idx
  ON notifications (user_id)
  WHERE read_at IS NULL;

-- 统计按时间范围聚合
CREATE INDEX matches_created_at_idx ON matches (created_at);
CREATE INDEX claims_created_at_idx ON claims (created_at);
CREATE INDEX users_department_idx ON users (department) WHERE role = 'USER';

-- 关键词模糊检索：pg_trgm 三元组索引，让 ILIKE '%关键词%' 也能走索引
CREATE INDEX posts_title_trgm_idx ON posts USING gin (title gin_trgm_ops);
CREATE INDEX posts_description_trgm_idx ON posts USING gin (description gin_trgm_ops);
CREATE INDEX posts_location_trgm_idx ON posts USING gin (location gin_trgm_ops);

-- 让新索引的统计信息立即生效
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