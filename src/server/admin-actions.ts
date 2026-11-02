"use server";

/**
 * 管理后台的服务端动作（CLFP-USR-0016、0025）。
 * 每个动作都会写入操作日志，并校验管理员身份。
 */
import { revalidatePath } from "next/cache";
import { recordAudit } from "@/lib/audit";
import { prisma } from "@/lib/db";
import { notify } from "@/lib/notifications";
import { DEFAULT_RAG_CONFIG, saveRagConfig } from "@/lib/rag/config";import { requireAdmin } from "@/lib/session";
import type { FormState } from "@/lib/form-state";

function text(formData: FormData, key: string): string {
  return String(formData.get(key) ?? "").trim();
}

function revalidatePostViews(postId: string) {
  revalidatePath("/admin/posts");
  revalidatePath("/admin");
  revalidatePath("/posts");
  revalidatePath(`/posts/${postId}`);
  revalidatePath("/");
  revalidatePath("/me/posts");
}

/** 下架信息（CLFP-USR-0016）：不对外展示，但作者仍能看到并收到通知 */
export async function takeDownPostAction(formData: FormData): Promise<void> {
  const admin = await requireAdmin();

  const postId = text(formData, "postId");
  const reason = text(formData, "reason") || "违反平台内容规范";

  const post = await prisma.post.findUnique({
    where: { id: postId },
    select: { id: true, title: true, authorId: true, takenDownAt: true },
  });
  if (!post || post.takenDownAt) return;

  await prisma.post.update({
    where: { id: post.id },
    data: { takenDownAt: new Date(), takeDownReason: reason, takenDownById: admin.id },
  });

  await recordAudit({
    operatorId: admin.id,
    action: "POST_TAKE_DOWN",
    targetType: "POST",
    targetId: post.id,
    detail: { title: post.title, reason },
  });

  await notify({
    userId: post.authorId,
    type: "SYSTEM",
    title: "你发布的信息已被下架",
    body: `《${post.title}》因「${reason}」被管理员下架，不再对外公开展示。如有疑问可联系管理员。`,
    link: `/posts/${post.id}`,
  });

  revalidatePostViews(post.id);
}

/** 恢复被下架的信息 */
export async function restorePostAction(formData: FormData): Promise<void> {
  const admin = await requireAdmin();

  const postId = text(formData, "postId");
  const post = await prisma.post.findUnique({
    where: { id: postId },
    select: { id: true, title: true, authorId: true, takenDownAt: true },
  });
  if (!post || !post.takenDownAt) return;

  await prisma.post.update({
    where: { id: post.id },
    data: { takenDownAt: null, takeDownReason: null, takenDownById: null },
  });

  await recordAudit({
    operatorId: admin.id,
    action: "POST_RESTORE",
    targetType: "POST",
    targetId: post.id,
    detail: { title: post.title },
  });

  await notify({
    userId: post.authorId,
    type: "SYSTEM",
    title: "你发布的信息已恢复展示",
    body: `《${post.title}》已由管理员恢复公开展示。`,
    link: `/posts/${post.id}`,
  });

  revalidatePostViews(post.id);
}

/** 管理员删除（软删除）：用于违规内容，作者无法自行恢复 */
export async function adminDeletePostAction(formData: FormData): Promise<void> {
  const admin = await requireAdmin();

  const postId = text(formData, "postId");
  const post = await prisma.post.findUnique({
    where: { id: postId },
    select: { id: true, title: true, authorId: true, deletedAt: true },
  });
  if (!post || post.deletedAt) return;

  await prisma.post.update({ where: { id: post.id }, data: { deletedAt: new Date() } });

  await recordAudit({
    operatorId: admin.id,
    action: "POST_DELETE",
    targetType: "POST",
    targetId: post.id,
    detail: { title: post.title },
  });

  await notify({
    userId: post.authorId,
    type: "SYSTEM",
    title: "你发布的信息已被管理员删除",
    body: `《${post.title}》已被管理员删除。`,
  });

  revalidatePostViews(post.id);
}

/** 新增物品类别（CLFP-USR-0025：不改代码即可新增类别） */
export async function createCategoryAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const admin = await requireAdmin();

  const name = text(formData, "name");
  if (name.length < 1 || name.length > 20) {
    return { fieldErrors: { name: "类别名称需为 1~20 个字" } };
  }

  const existing = await prisma.category.findUnique({ where: { name } });
  if (existing) return { fieldErrors: { name: "该类别已存在" } };

  const max = await prisma.category.aggregate({ _max: { sortOrder: true } });
  const category = await prisma.category.create({
    data: { name, sortOrder: (max._max.sortOrder ?? 0) + 1 },
  });

  await recordAudit({
    operatorId: admin.id,
    action: "CATEGORY_CREATE",
    targetType: "CATEGORY",
    targetId: category.id,
    detail: { name },
  });

  revalidatePath("/admin/config");
  revalidatePath("/posts/new");
  return { success: `类别「${name}」已创建` };
}

/** 启用 / 停用类别：停用后不再出现在发布表单与筛选中，但历史信息保留 */
export async function toggleCategoryAction(formData: FormData): Promise<void> {
  const admin = await requireAdmin();

  const categoryId = text(formData, "categoryId");
  const category = await prisma.category.findUnique({ where: { id: categoryId } });
  if (!category) return;

  await prisma.category.update({
    where: { id: category.id },
    data: { enabled: !category.enabled },
  });

  await recordAudit({
    operatorId: admin.id,
    action: "CATEGORY_UPDATE",
    targetType: "CATEGORY",
    targetId: category.id,
    detail: { name: category.name, enabled: !category.enabled },
  });

  revalidatePath("/admin/config");
  revalidatePath("/posts/new");
}

/** 调整匹配阈值与权重（CLFP-USR-0025：不改代码即可调阈值） */
export async function saveRagConfigAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const admin = await requireAdmin();

  const threshold = Number(text(formData, "threshold"));
  const maxMatches = Number(text(formData, "maxMatches"));
  const windowDays = Number(text(formData, "windowDays"));
  const weights = {
    vector: Number(text(formData, "weightVector")),
    category: Number(text(formData, "weightCategory")),
    location: Number(text(formData, "weightLocation")),
    time: Number(text(formData, "weightTime")),
    keyword: Number(text(formData, "weightKeyword")),
  };

  const fieldErrors: Record<string, string> = {};
  if (!Number.isFinite(threshold) || threshold < 0 || threshold > 1) {
    fieldErrors.threshold = "阈值需要在 0 到 1 之间";
  }
  if (!Number.isInteger(maxMatches) || maxMatches < 1 || maxMatches > 10) {
    fieldErrors.maxMatches = "每条最多推荐 1~10 条";
  }
  if (!Number.isInteger(windowDays) || windowDays < 1 || windowDays > 365) {
    fieldErrors.windowDays = "时间窗需要在 1~365 天之间";
  }
  for (const [key, value] of Object.entries(weights)) {
    if (!Number.isFinite(value) || value < 0 || value > 1) {
      fieldErrors[`weight${key[0].toUpperCase()}${key.slice(1)}`] = "权重需要在 0 到 1 之间";
    }
  }
  if (Object.keys(fieldErrors).length > 0) return { fieldErrors };

  const saved = await saveRagConfig({ threshold, maxMatches, windowDays, weights });

  await recordAudit({
    operatorId: admin.id,
    action: "CONFIG_UPDATE",
    targetType: "CONFIG",
    targetId: "rag.config",
    detail: saved as unknown as Record<string, unknown>,
  });

  revalidatePath("/admin/config");
  revalidatePath("/me/matches");
  return { success: "匹配配置已保存，新的发布将按新配置计算" };
}

/** 恢复默认匹配配置 */
export async function resetRagConfigAction(): Promise<void> {
  const admin = await requireAdmin();

  await saveRagConfig(DEFAULT_RAG_CONFIG);

  await recordAudit({
    operatorId: admin.id,
    action: "CONFIG_UPDATE",
    targetType: "CONFIG",
    targetId: "rag.config",
    detail: { reset: true },
  });

  revalidatePath("/admin/config");
}
