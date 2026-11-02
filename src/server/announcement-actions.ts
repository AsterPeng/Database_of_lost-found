"use server";

/** 公告管理动作（CLFP-USR-0024） */
import { revalidatePath } from "next/cache";
import { recordAudit } from "@/lib/audit";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/session";
import type { FormState } from "@/lib/form-state";

function text(formData: FormData, key: string): string {
  return String(formData.get(key) ?? "").trim();
}

function parseExpiresAt(value: string): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** 发布公告 */
export async function createAnnouncementAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const admin = await requireAdmin();

  const title = text(formData, "title");
  const body = text(formData, "body");
  const pinned = formData.get("pinned") !== null;
  const expiresAtRaw = text(formData, "expiresAt");

  const fieldErrors: Record<string, string> = {};
  if (title.length < 2 || title.length > 60) fieldErrors.title = "标题需为 2~60 个字";
  if (body.length < 5 || body.length > 2000) fieldErrors.body = "内容需为 5~2000 个字";
  if (Object.keys(fieldErrors).length > 0) return { fieldErrors };

  const expiresAt = parseExpiresAt(expiresAtRaw);

  const announcement = await prisma.announcement.create({
    data: { title, body, pinned, expiresAt, createdById: admin.id },
  });

  await recordAudit({
    operatorId: admin.id,
    action: "ANNOUNCEMENT_CREATE",
    targetType: "CONFIG",
    targetId: announcement.id,
    detail: { title, pinned },
  });

  revalidatePath("/admin/announcements");
  revalidatePath("/");

  return { success: "公告已发布" };
}

/** 置顶 / 取消置顶 */
export async function toggleAnnouncementPinnedAction(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const id = text(formData, "announcementId");

  const announcement = await prisma.announcement.findUnique({ where: { id } });
  if (!announcement) return;

  await prisma.announcement.update({
    where: { id: announcement.id },
    data: { pinned: !announcement.pinned },
  });

  await recordAudit({
    operatorId: admin.id,
    action: "ANNOUNCEMENT_PIN",
    targetType: "CONFIG",
    targetId: announcement.id,
    detail: { title: announcement.title, pinned: !announcement.pinned },
  });

  revalidatePath("/admin/announcements");
  revalidatePath("/");
}

/** 删除公告 */
export async function deleteAnnouncementAction(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const id = text(formData, "announcementId");

  const announcement = await prisma.announcement.findUnique({ where: { id } });
  if (!announcement) return;

  await prisma.announcement.delete({ where: { id: announcement.id } });

  await recordAudit({
    operatorId: admin.id,
    action: "ANNOUNCEMENT_DELETE",
    targetType: "CONFIG",
    targetId: announcement.id,
    detail: { title: announcement.title },
  });

  revalidatePath("/admin/announcements");
  revalidatePath("/");
}
