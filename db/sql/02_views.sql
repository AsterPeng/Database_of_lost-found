-- P2 数据库课程化改造：业务视图
-- 视图把“公开可见”“认领详情”“匹配总览”等常用多表连接固定下来，
-- 应用层可以直接查询视图，避免在各处重复维护过滤条件。

SET search_path = public;

-- =========================================================
-- 1. 公开帖子视图
-- =========================================================

CREATE OR REPLACE VIEW v_public_posts AS
SELECT
  p.id,
  p.author_id,
  p.type,
  p.title,
  p.description,
  p.category_id,
  c.name AS category_name,
  p.location,
  p.occurred_at,
  p.status,
  p.resolved_at,
  p.created_at,
  p.updated_at,
  u.nickname AS author_nickname,
  u.department AS author_department,
  cover.id AS cover_image_id,
  COALESCE(img.image_count, 0) AS image_count
FROM posts p
JOIN users u ON u.id = p.author_id
JOIN categories c ON c.id = p.category_id
LEFT JOIN LATERAL (
  SELECT pi.id
  FROM post_images pi
  WHERE pi.post_id = p.id
  ORDER BY pi.sort_order ASC, pi.created_at ASC
  LIMIT 1
) cover ON true
LEFT JOIN LATERAL (
  SELECT count(*)::int AS image_count
  FROM post_images pi
  WHERE pi.post_id = p.id
) img ON true
WHERE p.deleted_at IS NULL
  AND p.taken_down_at IS NULL
  AND p.archived_at IS NULL;

-- =========================================================
-- 2. 认领详情视图
-- =========================================================

CREATE OR REPLACE VIEW v_claim_detail AS
SELECT
  c.id AS claim_id,
  c.post_id,
  p.title AS post_title,
  p.author_id AS post_author_id,
  p.status AS post_status,
  c.claimant_id,
  cu.nickname AS claimant_nickname,
  c.message,
  c.proof,
  c.contact_masked,
  c.status AS claim_status,
  c.review_note,
  c.reviewed_by_id,
  c.reviewed_at,
  c.reviewer_role,
  c.escalate_at,
  c.escalated_at,
  c.created_at,
  c.updated_at,
  h.meet_at,
  h.meet_place,
  h.proposed_by_id,
  h.proposed_at,
  h.completed_at AS handover_completed_at,
  h.completed_by_id AS handover_completed_by_id,
  (
    SELECT count(*)::int
    FROM contact_grants g
    WHERE g.claim_id = c.id AND g.revoked_at IS NULL
  ) AS active_grant_count
FROM claims c
JOIN posts p ON p.id = c.post_id
JOIN users cu ON cu.id = c.claimant_id
LEFT JOIN handovers h ON h.claim_id = c.id;

-- =========================================================
-- 3. 匹配总览视图
-- =========================================================

CREATE OR REPLACE VIEW v_match_overview AS
SELECT
  m.id AS match_id,
  m.score,
  m.feedback,
  m.feedback_by_id,
  m.feedback_at,
  m.created_at,
  m.lost_post_id,
  lp.title AS lost_title,
  lp.author_id AS lost_author_id,
  lu.nickname AS lost_author_nickname,
  m.found_post_id,
  fp.title AS found_title,
  fp.author_id AS found_author_id,
  fu.nickname AS found_author_nickname
FROM matches m
JOIN posts lp ON lp.id = m.lost_post_id
JOIN users lu ON lu.id = lp.author_id
JOIN posts fp ON fp.id = m.found_post_id
JOIN users fu ON fu.id = fp.author_id;

-- =========================================================
-- 4. 管理首页汇总视图
-- =========================================================

CREATE OR REPLACE VIEW v_admin_dashboard AS
WITH post_stats AS (
  SELECT
    count(*)::int AS posts,
    count(*) FILTER (WHERE status = 'RESOLVED')::int AS resolved,
    count(*) FILTER (WHERE taken_down_at IS NOT NULL)::int AS taken_down,
    count(*) FILTER (
      WHERE created_at >= (now() AT TIME ZONE 'UTC') - interval '24 hours'
    )::int AS new_posts_24h
  FROM posts
  WHERE deleted_at IS NULL
)
SELECT
  (SELECT count(*)::int FROM users WHERE role = 'USER' AND status = 'ACTIVE') AS active_users,
  ps.posts,
  ps.resolved,
  ps.taken_down,
  ps.new_posts_24h,
  (SELECT count(*)::int FROM matches) AS matches,
  (
    SELECT count(*)::int
    FROM claims
    WHERE status = 'PENDING' AND escalated_at IS NOT NULL
  ) AS pending_admin_claims,
  CASE
    WHEN ps.posts = 0 THEN 0
    ELSE round(ps.resolved::numeric / ps.posts * 100)::int
  END AS recovery_rate
FROM post_stats ps;

-- =========================================================
-- 5. 待处理认领视图
-- =========================================================

CREATE OR REPLACE VIEW v_pending_claims AS
SELECT
  c.id AS claim_id,
  c.post_id,
  p.title AS post_title,
  c.claimant_id,
  c.escalate_at,
  c.escalated_at,
  (c.escalated_at IS NOT NULL) AS escalated,
  (now() AT TIME ZONE 'UTC') - c.created_at AS waiting
FROM claims c
JOIN posts p ON p.id = c.post_id
WHERE c.status = 'PENDING';

-- =========================================================
-- 6. 未读通知视图
-- =========================================================

CREATE OR REPLACE VIEW v_unread_notifications AS
SELECT
  n.id,
  n.user_id,
  n.type,
  n.title,
  n.body,
  n.link,
  n.deliver_at,
  n.created_at
FROM notifications n
WHERE n.read_at IS NULL
  AND n.deliver_at <= (now() AT TIME ZONE 'UTC');

COMMENT ON VIEW v_public_posts IS '公开可见的帖子（排除删除、下架、归档），含作者、类别与封面图';
COMMENT ON VIEW v_claim_detail IS '认领详情，含帖子、申请人、审核与交接信息';
COMMENT ON VIEW v_match_overview IS '匹配总览，含双方帖子与作者摘要';
COMMENT ON VIEW v_admin_dashboard IS '管理后台首页汇总指标';
COMMENT ON VIEW v_pending_claims IS '待处理认领，含等待时长与转交状态';
COMMENT ON VIEW v_unread_notifications IS '已送达但未读的站内通知';