import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PostOwnerActions } from "@/components/post-owner-actions";
import { Card } from "@/components/ui";
import { CLAIM_STATUS_LABEL, CLAIM_STATUS_STYLE } from "@/lib/claims";
import { POST_STATUS_LABEL, POST_STATUS_STYLE, POST_TYPE_LABEL } from "@/lib/constants";
import { prisma } from "@/lib/db";
import { formatDateTime, formatRelative } from "@/lib/datetime";
import { getCurrentUser } from "@/lib/session";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const post = await prisma.post.findFirst({
    where: { id, deletedAt: null },
    select: { title: true },
  });
  return { title: post ? `${post.title} · 校园失物招领平台` : "信息不存在" };
}

export default async function PostDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getCurrentUser();

  const post = await prisma.post.findFirst({
    where: { id, deletedAt: null },
    include: {
      category: { select: { name: true } },
      images: { orderBy: { sortOrder: "asc" }, select: { id: true } },
      author: { select: { id: true, nickname: true, department: true } },
    },
  });

  if (!post) notFound();

  const isOwner = user?.id === post.authorId;
  const isAdmin = user?.role === "ADMIN";

  // 被下架的信息：作者与管理员仍可查看，其他人按不存在处理（CLFP-USR-0016）
  if (post.takenDownAt && !isOwner && !isAdmin) notFound();

  // 作者关心有多少人申请认领，其他人关心自己的申请状态
  const [receivedCount, pendingCount, myClaim] = await Promise.all([
    prisma.claim.count({ where: { postId: post.id } }),
    prisma.claim.count({ where: { postId: post.id, status: "PENDING" } }),
    user && !isOwner
      ? prisma.claim.findUnique({
          where: { postId_claimantId: { postId: post.id, claimantId: user.id } },
        })
      : Promise.resolve(null),
  ]);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <Link href="/me/posts" className="inline-block text-sm text-slate-500 hover:text-sky-700">
        ← 返回
      </Link>

      {post.takenDownAt ? (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          这条信息已被管理员下架，不再对外公开展示。
          {post.takeDownReason ? `原因：${post.takeDownReason}` : ""}
        </div>
      ) : null}

      <Card>
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={`rounded px-2 py-0.5 text-xs font-medium ${
              post.type === "LOST" ? "bg-amber-50 text-amber-700" : "bg-teal-50 text-teal-700"
            }`}
          >
            {POST_TYPE_LABEL[post.type]}
          </span>
          <span className={`rounded px-2 py-0.5 text-xs ${POST_STATUS_STYLE[post.status]}`}>
            {POST_STATUS_LABEL[post.status]}
          </span>
        </div>

        <h1 className="mt-3 text-xl font-semibold text-slate-900">{post.title}</h1>

        <dl className="mt-4 grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
          <div className="flex gap-2">
            <dt className="text-slate-500">类别</dt>
            <dd className="text-slate-900">{post.category.name}</dd>
          </div>
          <div className="flex gap-2">
            <dt className="text-slate-500">{post.type === "LOST" ? "丢失时间" : "拾得时间"}</dt>
            <dd className="text-slate-900">{formatDateTime(post.occurredAt)}</dd>
          </div>
          <div className="flex gap-2">
            <dt className="text-slate-500">地点</dt>
            <dd className="text-slate-900">{post.location}</dd>
          </div>
          <div className="flex gap-2">
            <dt className="text-slate-500">发布者</dt>
            <dd className="text-slate-900">
              {post.author.nickname}
              {post.author.department ? (
                <span className="ml-1 text-slate-400">· {post.author.department}</span>
              ) : null}
            </dd>
          </div>
        </dl>

        {post.images.length > 0 ? (
          <div className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-3">
            {post.images.map((image) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                key={image.id}
                src={`/api/images/${image.id}`}
                alt={post.title}
                className="aspect-square w-full rounded-lg border border-slate-200 object-cover"
              />
            ))}
          </div>
        ) : null}

        <div className="mt-5">
          <h2 className="text-sm font-medium text-slate-700">
            {post.type === "LOST" ? "物品特征描述" : "拾得情况说明"}
          </h2>
          <p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-slate-700">
            {post.description}
          </p>
        </div>

        <p className="mt-4 text-xs text-slate-400">
          发布于 {formatRelative(post.createdAt)}
          {post.status === "RESOLVED" && post.resolvedAt
            ? ` · 于 ${formatRelative(post.resolvedAt)}标记为已解决`
            : ""}
        </p>
      </Card>

      {isOwner ? (
        <Card title="收到的认领申请">          <p className="text-sm text-slate-600">
            {receivedCount === 0
              ? "还没有人申请认领这条信息。"
              : `共有 ${receivedCount} 条认领申请${pendingCount > 0 ? `，其中 ${pendingCount} 条待你处理` : ""}。`}
          </p>
          {receivedCount > 0 ? (
            <Link
              href="/me/claims"
              className="mt-3 inline-block rounded-lg bg-sky-600 px-4 py-2 text-sm font-medium text-white hover:bg-sky-700"
            >
              去处理认领申请
            </Link>
          ) : null}
        </Card>
      ) : (
        <Card
          title="联系方式与认领"
          description="为保护隐私，发布者的联系方式默认脱敏显示（CLFP-USR-0014）。"
        >
          {myClaim ? (
            <p className="text-sm text-slate-700">
              你的认领申请状态：
              <span className={`ml-1 rounded px-2 py-0.5 text-xs ${CLAIM_STATUS_STYLE[myClaim.status]}`}>
                {CLAIM_STATUS_LABEL[myClaim.status]}
              </span>
              <Link href={`/me/claims/${myClaim.id}`} className="ml-3 text-sky-600 hover:underline">
                查看详情 →
              </Link>
            </p>
          ) : post.status !== "OPEN" ? (
            <p className="text-sm text-slate-500">这条信息已经结束，不再接受新的认领申请。</p>
          ) : user ? (
            <>
              <p className="text-sm text-slate-600">
                如果这是你丢失或拾获的物品，可以提交认领申请，由发布者核实凭证。
              </p>
              <Link
                href={`/posts/${post.id}/claim`}
                className="mt-3 inline-block rounded-lg bg-sky-600 px-4 py-2 text-sm font-medium text-white hover:bg-sky-700"
              >
                我要认领
              </Link>
            </>
          ) : (
            <p className="text-sm text-slate-600">
              <Link href="/login" className="text-sky-600 hover:underline">
                登录
              </Link>
              后可以发起认领申请。
            </p>
          )}
        </Card>
      )}

      {isOwner ? (
        <Card title="我的操作">
          <PostOwnerActions postId={post.id} status={post.status} type={post.type} />
        </Card>
      ) : null}

      {user && !isOwner ? (
        <p className="text-center text-xs text-slate-400">
          <Link href={`/posts/${post.id}/report`} className="hover:text-red-600">
            举报这条信息
          </Link>
        </p>
      ) : null}
    </div>
  );
}
