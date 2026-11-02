import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ClaimForm } from "@/components/claim-form";
import { Card } from "@/components/ui";
import { CLAIM_STATUS_LABEL, CLAIM_STATUS_STYLE } from "@/lib/claims";
import { POST_TYPE_LABEL } from "@/lib/constants";
import { prisma } from "@/lib/db";
import { formatDateTime } from "@/lib/datetime";
import { requireUser } from "@/lib/session";

export const metadata: Metadata = { title: "发起认领 · 校园失物招领平台" };

/** 发起认领申请（CLFP-USR-0011） */
export default async function ClaimPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();
  if (!user.profileCompleted) redirect("/onboarding");

  const post = await prisma.post.findFirst({
    where: { id, deletedAt: null },
    include: {
      category: { select: { name: true } },
      author: { select: { id: true, nickname: true } },
    },
  });
  if (!post) notFound();

  // 不能认领自己发布的信息，直接回到详情页
  if (post.authorId === user.id) redirect(`/posts/${post.id}`);

  const existing = await prisma.claim.findUnique({
    where: { postId_claimantId: { postId: post.id, claimantId: user.id } },
  });

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <Link href={`/posts/${post.id}`} className="inline-block text-sm text-slate-500 hover:text-sky-700">
        ← 返回信息详情
      </Link>

      <Card>
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={`rounded px-2 py-0.5 text-xs font-medium ${
              post.type === "LOST" ? "bg-amber-50 text-amber-700" : "bg-teal-50 text-teal-700"
            }`}
          >
            {POST_TYPE_LABEL[post.type]}
          </span>
          {post.status !== "OPEN" ? (
            <span className="rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
              该信息已结束
            </span>
          ) : null}
        </div>
        <h1 className="mt-2 text-lg font-semibold text-slate-900">{post.title}</h1>
        <p className="mt-1 text-sm text-slate-500">
          {post.category.name} · {post.location} · {formatDateTime(post.occurredAt)} · 发布者{" "}
          {post.author.nickname}
        </p>
      </Card>

      {existing && existing.status !== "REJECTED" && existing.status !== "CANCELLED" ? (
        <Card title="你已经提交过认领申请">
          <p className="text-sm text-slate-600">
            当前状态：
            <span className={`ml-1 rounded px-2 py-0.5 text-xs ${CLAIM_STATUS_STYLE[existing.status]}`}>
              {CLAIM_STATUS_LABEL[existing.status]}
            </span>
          </p>
          <Link
            href={`/me/claims/${existing.id}`}
            className="mt-3 inline-block text-sm text-sky-600 hover:underline"
          >
            查看申请详情 →
          </Link>
        </Card>
      ) : post.status !== "OPEN" ? (
        <Card>
          <p className="text-sm text-slate-600">这条信息已经结束，不能再发起认领。</p>
        </Card>
      ) : (
        <>
          {existing ? (
            <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              你之前的申请被{CLAIM_STATUS_LABEL[existing.status]}，可以补充信息后重新提交。
            </p>
          ) : null}

          <Card
            title="填写认领信息"
            description="审核人会根据你提供的凭证判断物品归属；请提供只有真正主人才知道的细节。"
          >
            <ClaimForm postId={post.id} />
          </Card>
        </>
      )}
    </div>
  );
}
