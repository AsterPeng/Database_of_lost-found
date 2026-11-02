"use server";

/** 用户管理动作：禁用、归档（CLFP-USR-0002、0021） */
import { revalidatePath } from "next/cache";
import { archiveGraduatedUsers, archiveUser, unarchiveUser } from "@/lib/archive";
import { recordAudit } from "@/lib/audit";
import { prisma } from "@/lib/db";
import { notify } from "@/lib/notifications";
import { requireAdmin } from "@/lib/session";

function text(formData: FormData, key: string): string {
  return String(formData.get(key) ?? "").trim();
}

function revalidateUserViews() {
  revalidatePath("/admin/users");
  revalidatePath("/admin");
  revalidatePath("/posts");
  revalidatePath("/");
}

/** 禁用账号：已有会话立即失效（getCurrentUser 会拒绝非 ACTIVE 账号） */
export async function banUserAction(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const userId = text(formData, "userId");

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, nickname: true, role: true, status: true },
  });
  if (!user || user.role === "ADMIN" || user.status === "BANNED") return;

  await prisma.user.update({ where: { id: user.id }, data: { status: "BANNED" } });
  await prisma.session.deleteMany({ where: { userId: user.id } });

  await recordAudit({
    operatorId: admin.id,
    action: "USER_BAN",
    targetType: "USER",
    targetId: user.id,
    detail: { nickname: user.nickname },
  });

  revalidateUserViews();
}

/** 解除禁用 */
export async function unbanUserAction(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const userId = text(formData, "userId");

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, nickname: true, status: true },
  });
  if (!user || user.status !== "BANNED") return;

  await prisma.user.update({ where: { id: user.id }, data: { status: "ACTIVE" } });

  await recordAudit({
    operatorId: admin.id,
    action: "USER_UNBAN",
    targetType: "USER",
    targetId: user.id,
    detail: { nickname: user.nickname },
  });

  await notify({
    userId: user.id,
    type: "SYSTEM",
    title: "账号已恢复正常",
    body: "你的账号已由管理员解除禁用，可以继续使用。",
  });

  revalidateUserViews();
}

/** 归档单个账号（毕业 / 离职） */
export async function archiveUserAction(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const userId = text(formData, "userId");

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, nickname: true, role: true, status: true },
  });
  if (!user || user.role === "ADMIN" || user.status === "ARCHIVED") return;

  const result = await archiveUser(user.id);

  await recordAudit({
    operatorId: admin.id,
    action: "USER_ARCHIVE",
    targetType: "USER",
    targetId: user.id,
    detail: { nickname: user.nickname, archivedPosts: result.posts },
  });

  revalidateUserViews();
}

/** 取消归档 */
export async function unarchiveUserAction(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const userId = text(formData, "userId");

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, nickname: true, status: true },
  });
  if (!user || user.status !== "ARCHIVED") return;

  const result = await unarchiveUser(user.id);

  await recordAudit({
    operatorId: admin.id,
    action: "USER_UNARCHIVE",
    targetType: "USER",
    targetId: user.id,
    detail: { nickname: user.nickname, restoredPosts: result.posts },
  });

  revalidateUserViews();
}

/** 按学号推算的毕业年份批量归档（CLFP-USR-0021 的自动规则） */
export async function archiveGraduatedAction(): Promise<void> {
  const admin = await requireAdmin();

  const result = await archiveGraduatedUsers();

  await recordAudit({
    operatorId: admin.id,
    action: "USER_ARCHIVE_BATCH",
    targetType: "USER",
    targetId: "batch",
    detail: { archivedUsers: result.users, archivedPosts: result.posts },
  });

  revalidateUserViews();
}
