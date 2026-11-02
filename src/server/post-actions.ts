"use server";

/**
 * 帖子相关的服务端动作：发布、编辑、软删除、状态流转。
 * 权限与状态校验一律在服务端执行（CLFP-USR-0005）。
 */
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { MAX_IMAGE_BYTES, MAX_IMAGES, MIN_IMAGES } from "@/lib/constants";
import { parseOccurredAt, postSchema } from "@/lib/post-validation";
import { processPostPipeline } from "@/lib/rag/pipeline";
import { removeImageFile, saveImage, ALLOWED_IMAGE_TYPES } from "@/lib/storage";
import { toFieldErrors } from "@/lib/validation";
import type { FormState } from "@/lib/form-state";

function text(formData: FormData, key: string): string {
  return String(formData.get(key) ?? "").trim();
}

/** 取出并校验上传的图片 */
function collectImages(formData: FormData): { files: File[]; error?: string } {
  const files = formData
    .getAll("images")
    .filter((value): value is File => value instanceof File && value.size > 0);

  if (files.length > MAX_IMAGES) return { files: [], error: `最多上传 ${MAX_IMAGES} 张照片` };
  for (const file of files) {
    if (!ALLOWED_IMAGE_TYPES.includes(file.type)) {
      return { files: [], error: "只支持 JPG / PNG / WebP / GIF 格式的图片" };
    }
    if (file.size > MAX_IMAGE_BYTES) {
      return { files: [], error: "单张照片不能超过 5MB" };
    }
  }
  return { files };
}

/** 解析并校验表单里的帖子字段 */
function parsePostForm(formData: FormData) {
  const parsed = postSchema.safeParse({
    type: text(formData, "type"),
    title: text(formData, "title"),
    categoryId: text(formData, "categoryId"),
    location: text(formData, "location"),
    description: text(formData, "description"),
    occurredAt: text(formData, "occurredAt"),
  });
  if (!parsed.success) return { fieldErrors: toFieldErrors(parsed.error) } as const;

  const { date, error } = parseOccurredAt(parsed.data.occurredAt);
  if (!date) return { fieldErrors: { occurredAt: error ?? "时间不正确" } } as const;

  return { data: { ...parsed.data, occurredAt: date } } as const;
}

async function findOwnedPost(postId: string, userId: string) {
  const post = await prisma.post.findFirst({
    where: { id: postId, deletedAt: null },
    include: { images: { orderBy: { sortOrder: "asc" } } },
  });
  if (!post) return { error: "信息不存在或已被删除" } as const;
  if (post.authorId !== userId) return { error: "只能操作自己发布的信息" } as const;
  return { post } as const;
}

/** 发布寻物启事 / 拾物信息（CLFP-USR-0003、0004） */
export async function createPostAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser();
  if (!user.profileCompleted) redirect("/onboarding");

  const parsed = parsePostForm(formData);
  if ("fieldErrors" in parsed) return { fieldErrors: parsed.fieldErrors };

  const { files, error: imageError } = collectImages(formData);
  if (imageError) return { fieldErrors: { images: imageError } };
  if (files.length < MIN_IMAGES) return { fieldErrors: { images: `请至少上传 ${MIN_IMAGES} 张照片` } };

  const category = await prisma.category.findFirst({
    where: { id: parsed.data.categoryId, enabled: true },
  });
  if (!category) return { fieldErrors: { categoryId: "请选择有效的物品类别" } };

  const post = await prisma.post.create({
    data: {
      authorId: user.id,
      type: parsed.data.type,
      title: parsed.data.title,
      description: parsed.data.description,
      categoryId: category.id,
      location: parsed.data.location,
      occurredAt: parsed.data.occurredAt,
    },
  });

  for (const [index, file] of files.entries()) {
    const image = await saveImage(file);
    await prisma.postImage.create({
      data: {
        postId: post.id,
        path: image.path,
        mimeType: image.mimeType,
        size: image.size,
        sortOrder: index,
      },
    });
  }

  // 向量化 + 语义匹配（CLFP-USR-0008、0020）。
  // 内部已做异常兜底：模型服务不可用时回退到本地向量，不会让发布失败。
  await processPostPipeline(post.id);

  revalidatePath("/me/posts");
  revalidatePath("/me/matches");
  revalidatePath("/posts");
  revalidatePath("/");
  redirect(`/posts/${post.id}`);
}

/** 编辑帖子：只有作者本人、且状态为「寻找中」时可改（CLFP-USR-0005） */
export async function updatePostAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser();

  const postId = text(formData, "postId");
  const owned = await findOwnedPost(postId, user.id);
  if ("error" in owned) return { error: owned.error };
  if (owned.post.status !== "OPEN") {
    return { error: "已完成或已关闭的信息不能再修改" };
  }

  const parsed = parsePostForm(formData);
  if ("fieldErrors" in parsed) return { fieldErrors: parsed.fieldErrors };

  const { files, error: imageError } = collectImages(formData);
  if (imageError) return { fieldErrors: { images: imageError } };

  const keepIds = formData.getAll("keepImageIds").map(String);
  const kept = owned.post.images.filter((image) => keepIds.includes(image.id));
  const removed = owned.post.images.filter((image) => !keepIds.includes(image.id));

  const total = kept.length + files.length;
  if (total < MIN_IMAGES) return { fieldErrors: { images: `请至少保留 ${MIN_IMAGES} 张照片` } };
  if (total > MAX_IMAGES) return { fieldErrors: { images: `最多保留 ${MAX_IMAGES} 张照片` } };

  await prisma.post.update({
    where: { id: owned.post.id },
    data: {
      type: parsed.data.type,
      title: parsed.data.title,
      description: parsed.data.description,
      categoryId: parsed.data.categoryId,
      location: parsed.data.location,
      occurredAt: parsed.data.occurredAt,
    },
  });

  if (removed.length > 0) {
    await prisma.postImage.deleteMany({ where: { id: { in: removed.map((i) => i.id) } } });
    for (const image of removed) await removeImageFile(image.path);
  }

  let order = 0;
  for (const image of kept) {
    await prisma.postImage.update({ where: { id: image.id }, data: { sortOrder: order++ } });
  }
  for (const file of files) {
    const saved = await saveImage(file);
    await prisma.postImage.create({
      data: {
        postId: owned.post.id,
        path: saved.path,
        mimeType: saved.mimeType,
        size: saved.size,
        sortOrder: order++,
      },
    });
  }

  // 内容改了，旧匹配不再可信：清理未反馈的匹配并重新计算
  await processPostPipeline(owned.post.id, { recomputeFromScratch: true });

  revalidatePath("/me/posts");
  revalidatePath("/me/matches");
  revalidatePath(`/posts/${owned.post.id}`);
  redirect(`/posts/${owned.post.id}`);
}

/** 软删除（CLFP-USR-0005）：已完成的信息不允许删除 */
export async function deletePostAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const postId = text(formData, "postId");

  const owned = await findOwnedPost(postId, user.id);
  if ("error" in owned) return;
  if (owned.post.status !== "OPEN") return;

  await prisma.post.update({
    where: { id: owned.post.id },
    data: { deletedAt: new Date() },
  });

  revalidatePath("/me/posts");
  revalidatePath("/");
  redirect("/me/posts");
}

/** 状态流转：标记为已找到 / 已归还（CLFP-USR-0023） */
export async function markResolvedAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const owned = await findOwnedPost(text(formData, "postId"), user.id);
  if ("error" in owned || owned.post.status !== "OPEN") return;

  await prisma.post.update({
    where: { id: owned.post.id },
    data: { status: "RESOLVED", resolvedAt: new Date() },
  });

  revalidatePath("/me/posts");
  revalidatePath(`/posts/${owned.post.id}`);
}

/** 状态流转：关闭信息 */
export async function closePostAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const owned = await findOwnedPost(text(formData, "postId"), user.id);
  if ("error" in owned || owned.post.status !== "OPEN") return;

  await prisma.post.update({ where: { id: owned.post.id }, data: { status: "CLOSED" } });

  revalidatePath("/me/posts");
  revalidatePath(`/posts/${owned.post.id}`);
}
