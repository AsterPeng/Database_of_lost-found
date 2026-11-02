-- =========================================================
-- 校园失物招领平台 数据库课程设计
-- 07 基准数据生成（P6）
--
-- 目标库：clfp_bench（请勿在 clfp_enhanced / clfp_test / clfp_original 执行）
-- 数据规模：10 万用户、10 万帖子（5 万 LOST + 5 万 FOUND）、
--           10 万匹配、10 万认领、10 万通知。
-- 使用 generate_series 集合插入，避免逐行应用层写入。
-- =========================================================

SET search_path = public;
SET statement_timeout = 0;

-- 清理上一次生成的数据；用户删除会级联帖子、匹配、认领、通知
DELETE FROM users WHERE id LIKE 'bench-u-%';

-- =========================================================
-- 1. 用户：10 万
-- =========================================================

INSERT INTO users (
  id, email, password_hash, nickname, department, role, status,
  profile_completed, created_at, updated_at
)
SELECT
  'bench-u-' || lpad(i::text, 6, '0'),
  'bench-user-' || i || '@example.invalid',
  'bench-placeholder',
  'Bench 用户 ' || i,
  CASE
    WHEN i % 20 = 0 THEN NULL
    ELSE (ARRAY['计算机学院','数学学院','外国语学院','物理学院','化学学院','信息学院'])[(i % 6) + 1]
  END,
  'USER'::"Role",
  'ACTIVE'::"UserStatus",
  true,
  (now() AT TIME ZONE 'UTC') - ((i % 365) || ' days')::interval,
  (now() AT TIME ZONE 'UTC') - ((i % 30) || ' days')::interval
FROM generate_series(1, 100000) AS s(i)
ON CONFLICT (id) DO NOTHING;

-- =========================================================
-- 2. 帖子：10 万（1..50000 为 LOST，50001..100000 为 FOUND）
-- =========================================================

WITH categories_ranked AS (
  SELECT
    id,
    row_number() OVER (ORDER BY sort_order, name) - 1 AS rn,
    count(*) OVER () AS n
  FROM categories
)
INSERT INTO posts (
  id, author_id, type, title, description, category_id, location,
  occurred_at, status, resolved_at, deleted_at, taken_down_at, archived_at,
  created_at, updated_at
)
SELECT
  'bench-p-' || lpad(i::text, 6, '0'),
  'bench-u-' || lpad(i::text, 6, '0'),
  CASE WHEN i <= 50000 THEN 'LOST'::"PostType" ELSE 'FOUND'::"PostType" END,
  CASE
    WHEN i % 100 = 0 THEN '稀有物品 ' || i
    WHEN i % 2 = 0 THEN '丢失钥匙 ' || i
    ELSE '捡到钥匙 ' || i
  END,
  CASE
    WHEN i % 100 = 0 THEN '稀有物品，第' || i || '号，图书馆，价值很高'
    ELSE '蓝色钥匙，图书馆，第' || i || '号，丢失物品描述'
  END,
  c.id,
  (ARRAY['图书馆','教学楼','体育馆','食堂','宿舍'])[(i % 5) + 1],
  ts,
  CASE WHEN i % 20 = 0 THEN 'RESOLVED'::"PostStatus" ELSE 'OPEN'::"PostStatus" END,
  CASE WHEN i % 20 = 0 THEN ts ELSE NULL END,
  CASE WHEN i % 37 = 0 THEN ts ELSE NULL END,
  CASE WHEN i % 53 = 0 THEN ts ELSE NULL END,
  CASE WHEN i % 97 = 0 THEN ts ELSE NULL END,
  ts,
  ts
FROM generate_series(1, 100000) AS s(i)
CROSS JOIN LATERAL (
  SELECT (now() AT TIME ZONE 'UTC') - ((i % 180) || ' days')::interval AS ts
) t
JOIN categories_ranked c ON c.rn = (i - 1) % c.n
ON CONFLICT (id) DO NOTHING;

-- =========================================================
-- 3. 匹配：10 万（每对 LOST / FOUND 唯一）
-- =========================================================

INSERT INTO matches (
  id, lost_post_id, found_post_id, score, detail, feedback, created_at, updated_at
)
SELECT
  'bench-m-a-' || lpad(i::text, 6, '0'),
  'bench-p-' || lpad(i::text, 6, '0'),
  'bench-p-' || lpad((i + 50000)::text, 6, '0'),
  (0.5 + (i % 50) / 100.0)::double precision,
  jsonb_build_object('confidence', 0.5 + (i % 50) / 100.0),
  'NONE'::"MatchFeedback",
  (now() AT TIME ZONE 'UTC') - ((i % 180) || ' days')::interval,
  (now() AT TIME ZONE 'UTC')
FROM generate_series(1, 50000) AS s(i)
ON CONFLICT (lost_post_id, found_post_id) DO NOTHING;

INSERT INTO matches (
  id, lost_post_id, found_post_id, score, detail, feedback, created_at, updated_at
)
SELECT
  'bench-m-b-' || lpad(i::text, 6, '0'),
  'bench-p-' || lpad(i::text, 6, '0'),
  'bench-p-' || lpad((50000 + ((i % 50000) + 1))::text, 6, '0'),
  (0.5 + ((i + 7) % 50) / 100.0)::double precision,
  jsonb_build_object('confidence', 0.5 + ((i + 7) % 50) / 100.0),
  'NONE'::"MatchFeedback",
  (now() AT TIME ZONE 'UTC') - (((i + 11) % 180) || ' days')::interval,
  (now() AT TIME ZONE 'UTC')
FROM generate_series(1, 50000) AS s(i)
ON CONFLICT (lost_post_id, found_post_id) DO NOTHING;

-- =========================================================
-- 4. 认领：10 万（每条帖子一条，申请人与作者不同）
-- =========================================================

INSERT INTO claims (
  id, post_id, claimant_id, message, proof,
  contact_encrypted, contact_masked, status, escalate_at, created_at, updated_at
)
SELECT
  'bench-c-' || lpad(i::text, 6, '0'),
  'bench-p-' || lpad(i::text, 6, '0'),
  CASE
    WHEN i <= 50000 THEN 'bench-u-' || lpad((i + 50000)::text, 6, '0')
    ELSE 'bench-u-' || lpad((i - 50000)::text, 6, '0')
  END,
  'Bench claim ' || i,
  'Bench proof ' || i,
  'bench-encrypted',
  '138****' || lpad((i % 10000)::text, 4, '0'),
  'PENDING'::"ClaimStatus",
  created_at + interval '48 hours',
  created_at,
  created_at
FROM generate_series(1, 100000) AS s(i)
CROSS JOIN LATERAL (
  SELECT (now() AT TIME ZONE 'UTC') - ((i % 180) || ' days')::interval AS created_at
) t
ON CONFLICT (post_id, claimant_id) DO NOTHING;

-- =========================================================
-- 5. 通知：10 万（约 1/3 已读）
-- =========================================================

INSERT INTO notifications (
  id, user_id, type, title, body, link, deliver_at, read_at, created_at
)
SELECT
  'bench-n-' || lpad(i::text, 6, '0'),
  'bench-u-' || lpad(((i % 100000) + 1)::text, 6, '0'),
  'SYSTEM'::"NotificationType",
  'Bench notification ' || i,
  'Bench body ' || i,
  NULL,
  created_at,
  CASE WHEN i % 3 = 0 THEN created_at ELSE NULL END,
  created_at
FROM generate_series(1, 100000) AS s(i)
CROSS JOIN LATERAL (
  SELECT (now() AT TIME ZONE 'UTC') - ((i % 90) || ' days')::interval AS created_at
) t
ON CONFLICT (id) DO NOTHING;

-- =========================================================
-- 6. 统计信息
-- =========================================================

ANALYZE users;
ANALYZE posts;
ANALYZE categories;
ANALYZE matches;
ANALYZE claims;
ANALYZE notifications;

SELECT
  (SELECT count(*) FROM users WHERE id LIKE 'bench-u-%') AS bench_users,
  (SELECT count(*) FROM posts WHERE id LIKE 'bench-p-%') AS bench_posts,
  (SELECT count(*) FROM matches WHERE id LIKE 'bench-m-%') AS bench_matches,
  (SELECT count(*) FROM claims WHERE id LIKE 'bench-c-%') AS bench_claims,
  (SELECT count(*) FROM notifications WHERE id LIKE 'bench-n-%') AS bench_notifications;