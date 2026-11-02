/**
 * 管理员操作日志（CLFP-USR-0016）。
 * 所有管理动作都通过这里写入，便于事后追溯与责任界定。
 */
import type { Prisma } from "@prisma/client";
import { prisma } from "./db";

export type AuditTargetType = "POST" | "USER" | "CLAIM" | "CATEGORY" | "CONFIG";

export type AuditInput = {
  operatorId: string | null;
  action: string;
  targetType: AuditTargetType;
  targetId: string;
  detail?: Record<string, unknown>;
};

export async function recordAudit(input: AuditInput): Promise<void> {
  await prisma.auditLog.create({
    data: {
      operatorId: input.operatorId,
      action: input.action,
      targetType: input.targetType,
      targetId: input.targetId,
      detail: (input.detail ?? undefined) as Prisma.InputJsonValue | undefined,
    },
  });
}

export const AUDIT_ACTION_LABEL: Record<string, string> = {
  POST_TAKE_DOWN: "下架信息",
  POST_RESTORE: "恢复信息",
  POST_DELETE: "删除信息",
  USER_BAN: "禁用账号",
  USER_UNBAN: "解除禁用",
  USER_ARCHIVE: "归档账号",
  USER_UNARCHIVE: "取消归档",
  USER_ARCHIVE_BATCH: "批量归档毕业生",
  CATEGORY_CREATE: "新增类别",
  CATEGORY_UPDATE: "修改类别",
  CONFIG_UPDATE: "修改匹配配置",
  CLAIM_REVIEW: "审核认领",
  REPORT_RESOLVE: "受理举报",
  REPORT_REJECT: "驳回举报",
  ANNOUNCEMENT_CREATE: "发布公告",
  ANNOUNCEMENT_PIN: "置顶公告",
  ANNOUNCEMENT_DELETE: "删除公告",
};

export const AUDIT_TARGET_LABEL: Record<string, string> = {
  POST: "信息",
  USER: "用户",
  CLAIM: "认领",
  CATEGORY: "类别",
  CONFIG: "配置",
};

export function auditActionLabel(action: string): string {
  return AUDIT_ACTION_LABEL[action] ?? action;
}
