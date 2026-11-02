import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { PostForm } from "@/components/post-form";
import { prisma } from "@/lib/db";
import { toLocalDateTimeInput } from "@/lib/datetime";
import { requireUser } from "@/lib/session";

export const metadata: Metadata = { title: "编辑信息 · 校园失物招领平台" };

/** 编辑帖子：只有作者本人、且状态为「寻找中」时可进入（CLFP-USR-0005） */
export default async function EditPostPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();

  const post = await prisma.post.findFirst({
    where: { id, deletedAt: null },
    include: { images: { orderBy: { sortOrder: "asc" }, select: { id: true } } },
  });

  if (!post) notFound();
  if (post.authorId !== user.id || post.status !== "OPEN" || post.takenDownAt) {
    redirect(`/posts/${post.id}`);
  }

  const categories = await prisma.category.findMany({
    where: { enabled: true },
    orderBy: { sortOrder: "asc" },
    select: { id: true, name: true },
  });

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">编辑信息</h1>
        <p className="mt-1 text-sm text-slate-500">
          修改后系统会重新计算匹配结果；标记为已解决后将不能再修改。
        </p>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <PostForm
          mode="edit"
          postId={post.id}
          categories={categories}
          defaultOccurredAt={toLocalDateTimeInput(post.occurredAt)}
          existingImages={post.images}
          defaults={{
            type: post.type,
            title: post.title,
            categoryId: post.categoryId,
            location: post.location,
            description: post.description,
            occurredAt: toLocalDateTimeInput(post.occurredAt),
          }}
        />
      </div>
    </div>
  );
}
