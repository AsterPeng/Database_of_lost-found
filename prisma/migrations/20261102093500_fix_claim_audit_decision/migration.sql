-- 修正认领审计触发器的 decision 字段：
-- 应用层与 verify-admin-claims 脚本使用 ACCEPT / REJECT，
-- 而原实现写成了 ACCEPTED / REJECTED。触发器函数可原地替换，
-- 已存在的触发器会自动使用新函数。

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