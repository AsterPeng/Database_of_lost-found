-- 修正与 ON DELETE SET NULL 不兼容的 CHECK：
-- 1) 删除审核人时 claims.reviewed_by_id 会被置空，但 status 仍为 ACCEPTED/REJECTED；
--    因此不能要求“已审核状态必须有 reviewed_by_id”。
-- 2) 删除交接确认人时 handovers.completed_by_id 会被置空，但 completed_at 保留；
--    因此只禁止“有确认人但没有完成时间”，允许完成时间为空时确认人为空。

ALTER TABLE claims
  DROP CONSTRAINT IF EXISTS claims_review_consistency_check;

ALTER TABLE handovers
  DROP CONSTRAINT IF EXISTS handovers_completion_check,
  ADD CONSTRAINT handovers_completion_check
  CHECK (completed_at IS NOT NULL OR completed_by_id IS NULL);