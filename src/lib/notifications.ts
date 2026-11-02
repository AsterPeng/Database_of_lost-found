/**
 * 站内通知（CLFP-USR-0013）与消息偏好（CLFP-USR-0019）。
 *
 * Web 版用通知中心替代微信订阅消息：通知写入数据库，并在通知中心展示。
 * 处于免打扰时段内的通知不会立刻送达，而是把 deliverAt 推迟到时段结束，
 * 通知中心对未到时间的通知只显示「暂缓发送」的提示而不展示内容。
 */
import type { NotificationPreference } from "@prisma/client";
import { prisma } from "./db";

export const DEFAULT_QUIET_START = 22;
export const DEFAULT_QUIET_END = 7;

export type NotificationInput = {
  userId: string;
  type: "MATCH" | "CLAIM_RECEIVED" | "CLAIM_RESULT" | "CLAIM_ESCALATED" | "HANDOVER" | "SYSTEM";
  title: string;
  body: string;
  link?: string;
};

/** 判断某个小时是否落在免打扰时段内（支持跨天，如 22:00–次日 7:00） */
export function isInQuietHours(hour: number, start: number, end: number): boolean {
  if (start === end) return false;
  return start < end ? hour >= start && hour < end : hour >= start || hour < end;
}

/**
 * 计算通知的实际送达时间。
 * 纯函数，便于单元测试：处于免打扰时段时推迟到时段结束的整点。
 */
export function computeDeliverAt(
  preference: Pick<NotificationPreference, "quietEnabled" | "quietStart" | "quietEnd"> | null,
  now: Date = new Date(),
): Date {
  if (!preference?.quietEnabled) return now;
  if (!isInQuietHours(now.getHours(), preference.quietStart, preference.quietEnd)) return now;

  const deliverAt = new Date(now);
  deliverAt.setHours(preference.quietEnd, 0, 0, 0);
  if (deliverAt.getTime() <= now.getTime()) {
    deliverAt.setDate(deliverAt.getDate() + 1);
  }
  return deliverAt;
}

export async function getNotificationPreference(userId: string) {
  return prisma.notificationPreference.findUnique({ where: { userId } });
}

/** 创建一条通知；用户关闭了站内通知时不写入 */
export async function notify(input: NotificationInput): Promise<void> {
  const preference = await getNotificationPreference(input.userId);
  if (preference && !preference.inApp) return;

  await prisma.notification.create({
    data: {
      userId: input.userId,
      type: input.type,
      title: input.title,
      body: input.body,
      link: input.link ?? null,
      deliverAt: computeDeliverAt(preference ?? null),
    },
  });
}

/** 批量通知（例如通知全部管理员） */
export async function notifyMany(inputs: NotificationInput[]): Promise<void> {
  for (const input of inputs) {
    await notify(input);
  }
}

/** 通知全部管理员 */
export async function notifyAdmins(
  input: Omit<NotificationInput, "userId">,
): Promise<void> {
  const admins = await prisma.user.findMany({
    where: { role: "ADMIN", status: "ACTIVE" },
    select: { id: true },
  });
  await notifyMany(admins.map((admin) => ({ ...input, userId: admin.id })));
}

export const NOTIFICATION_TYPE_LABEL = {
  MATCH: "匹配推荐",
  CLAIM_RECEIVED: "收到认领",
  CLAIM_RESULT: "审核结果",
  CLAIM_ESCALATED: "认领超时",
  HANDOVER: "交接提醒",
  SYSTEM: "系统消息",
} as const;

export const NOTIFICATION_TYPE_STYLE = {
  MATCH: "bg-sky-50 text-sky-700",
  CLAIM_RECEIVED: "bg-amber-50 text-amber-700",
  CLAIM_RESULT: "bg-emerald-50 text-emerald-700",
  CLAIM_ESCALATED: "bg-purple-50 text-purple-700",
  HANDOVER: "bg-teal-50 text-teal-700",
  SYSTEM: "bg-slate-100 text-slate-600",
} as const;

/** 未读通知数量，用于导航角标 */
export async function countUnreadNotifications(userId: string): Promise<number> {
  return prisma.notification.count({
    where: { userId, readAt: null, deliverAt: { lte: new Date() } },
  });
}
