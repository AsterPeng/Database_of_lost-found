import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { PostForm } from "@/components/post-form";
import { prisma } from "@/lib/db";
import { toLocalDateTimeInput } from "@/lib/datetime";
import { requireUser } from "@/lib/session";

export const metadata: Metadata = { title: "发布信息 · 校园失物招领平台" };

export default async function NewPostPage() {
  const user = await requireUser();
  // 校内资料没填完不能发布（CLFP-USR-0001）
  if (!user.profileCompleted) redirect("/onboarding");

  const categories = await prisma.category.findMany({
    where: { enabled: true },
    orderBy: { sortOrder: "asc" },
    select: { id: true, name: true },
  });

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="section-heading text-2xl font-bold text-slate-900">发布信息</h1>
        <p className="mt-1 text-sm text-slate-500">
          填写物品信息并上传照片，系统会自动做语义匹配，帮你找到可能相关的人。
        </p>
      </div>

      <div className="paper-panel p-6">
        <PostForm
          mode="create"
          categories={categories}
          defaultOccurredAt={toLocalDateTimeInput(new Date())}
        />
      </div>
    </div>
  );
}
