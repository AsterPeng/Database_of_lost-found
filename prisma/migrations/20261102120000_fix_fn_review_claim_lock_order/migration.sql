-- P5 并发修复：fn_review_claim 调整为“帖子 → 认领”的固定加锁顺序
-- 原因：原实现先锁认领再锁帖子，同一帖子多条认领并发审核时，
--       获胜事务更新其他被锁认领会与等待帖子锁的事务形成死锁（40P01）。
-- 影响：业务结果不变，仅改变加锁顺序；已在 clfp_test 并发实验中验证。

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
  v_post_id text;
  v_decision text := upper(coalesce(p_decision, ''));
  v_now timestamp(3) := (now() AT TIME ZONE 'UTC');
  v_rejected jsonb := '[]'::jsonb;
BEGIN
  -- 先读 post_id（不加锁），再按“帖子 → 认领”的固定顺序加锁。
  -- 同一帖子的并发审核都先竞争帖子行锁，避免“各自锁认领后再等帖子”形成死锁。
  SELECT post_id INTO v_post_id FROM claims WHERE id = p_claim_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'code', 'CLAIM_NOT_FOUND');
  END IF;

  SELECT * INTO v_post FROM posts WHERE id = v_post_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'code', 'POST_NOT_FOUND');
  END IF;

  SELECT * INTO v_claim FROM claims WHERE id = p_claim_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'code', 'CLAIM_NOT_FOUND');
  END IF;

  IF v_claim.status <> 'PENDING' THEN
    RETURN jsonb_build_object('ok', false, 'code', 'CLAIM_NOT_PENDING');
  END IF;

  -- 认领的 post_id 理论上不会变化；加锁后复核，避免读到不一致的快照
  IF v_claim.post_id <> v_post.id THEN
    RETURN jsonb_build_object('ok', false, 'code', 'CLAIM_NOT_PENDING');
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

