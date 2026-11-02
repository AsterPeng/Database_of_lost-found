-- =========================================================
-- 校园失物招领平台 数据库课程设计
-- 04 触发器（P2 最终版本）
-- 包含：帖子状态机、匹配一致性、认领审核审计
-- =========================================================

SET search_path = public;

-- ---------------------------------------------------------
-- 1. 帖子状态机
-- ---------------------------------------------------------

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

-- ---------------------------------------------------------
-- 2. 匹配一致性
-- ---------------------------------------------------------

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

-- ---------------------------------------------------------
-- 3. 认领审核审计
-- ---------------------------------------------------------

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
        'decision', CASE NEW.status WHEN 'ACCEPTED' THEN 'ACCEPT' ELSE 'REJECT' END,
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

COMMENT ON FUNCTION fn_post_status_transition() IS '帖子状态机：只允许 OPEN -> RESOLVED 或 OPEN -> CLOSED';
COMMENT ON FUNCTION fn_match_integrity() IS '匹配一致性：一端 LOST、一端 FOUND，不能自匹配或匹配同一作者';
COMMENT ON FUNCTION fn_claim_audit() IS '管理员审核认领时写入 audit_logs；作者审核与级联自动拒绝不写管理日志';