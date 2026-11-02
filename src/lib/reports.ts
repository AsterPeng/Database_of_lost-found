/** 举报相关常量（CLFP-USR-0015） */

export const REPORT_REASONS = [
  "不实信息",
  "重复信息",
  "涉嫌诈骗",
  "违规内容",
  "其他",
] as const;

export type ReportReason = (typeof REPORT_REASONS)[number];

export const REPORT_STATUS_LABEL = {
  PENDING: "待处理",
  RESOLVED: "已受理",
  REJECTED: "已驳回",
} as const;

export const REPORT_STATUS_STYLE = {
  PENDING: "bg-amber-50 text-amber-700",
  RESOLVED: "bg-emerald-50 text-emerald-700",
  REJECTED: "bg-slate-100 text-slate-500",
} as const;
