"use server";

/** 通知相关的服务端动作（CLFP-USR-0013、0019） */
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/session";
import type { FormState } from "@/lib/form-state";

function text(formData: FormData, key: string): string {
  return String(formData.get(key) ?? "").trim();
}

/** 标记单条通知为已读 */
export async function markNotificationReadAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const id = text(formData, "notificationId");
  if (!id) return;

  await prisma.notification.updateMany({
    where: { id, userId: user.id, readAt: null },
    data: { readAt: new Date() },
  });

  revalidatePath("/me/notifications");
  revalidatePath("/me");
}

/** 全部标记为已读 */
export async function markAllNotificationsReadAction(): Promise<void> {
  const user = await requireUser();

  await prisma.notification.updateMany({
    where: { userId: user.id, readAt: null, deliverAt: { lte: new Date() } },
    data: { readAt: new Date() },
  });

  revalidatePath("/me/notifications");
  revalidatePath("/me");
}

/** 更新消息接收偏好与免打扰时段（CLFP-USR-0019） */
export async function updateNotificationPreferenceAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const user = await requireUser();

  const inApp = formData.get("inApp") !== null;
  const email = formData.get("email") !== null;
  const quietEnabled = formData.get("quietEnabled") !== null;

  const quietStart = Number(text(formData, "quietStart"));
  const quietEnd = Number(text(formData, "quietEnd"));

  if (!Number.isInteger(quietStart) || quietStart < 0 || quietStart > 23) {
    return { fieldErrors: { quietStart: "免打扰开始时间必须是 0-23 之间的整数" } };
  }
  if (!Number.isInteger(quietEnd) || quietEnd < 0 || quietEnd > 23) {
    return { fieldErrors: { quietEnd: "免打扰结束时间必须是 0-23 之间的整数" } };
  }

  await prisma.notificationPreference.upsert({
    where: { userId: user.id },
    update: { inApp, email, quietEnabled, quietStart, quietEnd },
    create: { userId: user.id, inApp, email, quietEnabled, quietStart, quietEnd },
  });

  revalidatePath("/settings");
  revalidatePath("/me/notifications");

  return { success: "通知偏好已保存" };
}
