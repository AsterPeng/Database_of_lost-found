import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ReportForm } from "@/components/report-form";
import { Card } from "@/components/ui";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/session";

export const metadata: Metadata = { title: "举报信息 · 校园失物招领平台" };

/** 举报信息（CLFP-USR-0015） */
export default async function ReportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();

  const post = await prisma.post.findFirst({
    where: { id, deletedAt: null },
    select: { id: true, title: true, authorId: true },
  });
  if (!post) notFound();
  if (post.authorId === user.id) redirect(`/posts/${post.id}`);

  const existing = await prisma.report.findUnique({
    where: {
      reporterId_targetType_targetId: {
        reporterId: user.id,
        targetType: "POST",
        targetId: post.id,
      },
    },
  });

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <Link href={`/posts/${post.id}`} className="inline-block text-sm text-slate-500 hover:text-sky-700">
        ← 返回信息详情
      </Link>

      <Card>
        <h1 className="text-lg font-semibold text-slate-900">举报信息</h1>
        <p className="mt-1 text-sm text-slate-500">举报对象：{post.title}</p>
      </Card>

      {existing ? (
        <Card title="你已举报过这条信息">
          <p className="text-sm text-slate-600">
            举报已提交，管理员会尽快核实处理。请勿重复提交。
          </p>
          <Link href="/me" className="mt-3 inline-block text-sm text-sky-600 hover:underline">
            返回个人中心
          </Link>
        </Card>
      ) : (
        <Card
          title="填写举报信息"
          description="举报会提交给管理员核实；恶意举报可能影响你的账号使用。"
        >
          <ReportForm postId={post.id} />
        </Card>
      )}
    </div>
  );
}
