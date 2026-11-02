import type { Metadata } from "next";
import Link from "next/link";
import { PostCard } from "@/components/post-card";
import { PostOwnerActions } from "@/components/post-owner-actions";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/session";

export const metadata: Metadata = { title: "我的发布 · 校园失物招领平台" };

const FILTERS = [
  { key: "all", label: "全部" },
  { key: "OPEN", label: "寻找中" },
  { key: "RESOLVED", label: "已解决" },
  { key: "CLOSED", label: "已关闭" },
] as const;

export default async function MyPostsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const user = await requireUser();
  const { status } = await searchParams;
  const active = FILTERS.find((filter) => filter.key === status)?.key ?? "all";

  const posts = await prisma.post.findMany({
    where: {
      authorId: user.id,
      deletedAt: null,
      ...(active === "all" ? {} : { status: active }),
    },
    orderBy: { createdAt: "desc" },
    include: {
      category: { select: { name: true } },
      images: { orderBy: { sortOrder: "asc" }, take: 1, select: { id: true } },
    },
  });

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">我的发布</h1>
          <p className="mt-1 text-sm text-slate-500">
            尚未完成的信息可以编辑、关闭或删除；已完成的信息只可查看（CLFP-USR-0005）。
          </p>
        </div>
        <Link
          href="/posts/new"
          className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-medium text-white hover:bg-sky-700"
        >
          发布新信息
        </Link>
      </div>

      <div className="flex flex-wrap gap-2 text-sm">
        {FILTERS.map((filter) => (
          <Link
            key={filter.key}
            href={filter.key === "all" ? "/me/posts" : `/me/posts?status=${filter.key}`}
            className={`rounded-lg border px-3 py-1.5 transition ${
              active === filter.key
                ? "border-sky-500 bg-sky-50 text-sky-700"
                : "border-slate-300 bg-white text-slate-600 hover:bg-slate-50"
            }`}
          >
            {filter.label}
          </Link>
        ))}
      </div>

      {posts.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center">
          <p className="text-sm text-slate-500">这里还没有信息。</p>
          <Link href="/posts/new" className="mt-3 inline-block text-sm text-sky-600 hover:underline">
            去发布一条
          </Link>
        </div>
      ) : (
        <ul className="space-y-5">
          {posts.map((post) => (
            <li key={post.id} className="space-y-2">
              {post.takenDownAt ? (
                <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                  这条信息已被管理员下架，不再对外展示
                  {post.takeDownReason ? `（原因：${post.takeDownReason}）` : ""}
                </p>
              ) : null}
              <PostCard
                post={{
                  id: post.id,
                  type: post.type,
                  title: post.title,
                  status: post.status,
                  location: post.location,
                  occurredAt: post.occurredAt,
                  categoryName: post.category.name,
                  coverImageId: post.images[0]?.id ?? null,
                }}
              />
              <div className="px-1">
                <PostOwnerActions postId={post.id} status={post.status} type={post.type} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
