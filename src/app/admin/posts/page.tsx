import type { Metadata } from "next";
import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { POST_STATUS_LABEL, POST_STATUS_STYLE, POST_TYPE_LABEL } from "@/lib/constants";
import { prisma } from "@/lib/db";
import { formatDateTime, formatRelative } from "@/lib/datetime";
import { adminDeletePostAction, restorePostAction, takeDownPostAction } from "@/server/admin-actions";

export const metadata: Metadata = { title: "信息管理 · 校园失物招领平台" };

const STATES = [
  { key: "all", label: "全部" },
  { key: "open", label: "寻找中" },
  { key: "resolved", label: "已解决" },
  { key: "taken_down", label: "已下架" },
  { key: "deleted", label: "已删除" },
] as const;

function buildHref(state: string, q: string, overrides: { state?: string; q?: string } = {}) {
  const params = new URLSearchParams();
  const nextState = overrides.state ?? state;
  const nextQ = overrides.q ?? q;
  if (nextState && nextState !== "all") params.set("state", nextState);
  if (nextQ) params.set("q", nextQ);
  const query = params.toString();
  return `/admin/posts${query ? `?${query}` : ""}`;
}

/** 信息管理：先发后审模式下的内容审核与下架（CLFP-USR-0016） */
export default async function AdminPostsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const state = typeof params.state === "string" ? params.state : "all";
  const q = typeof params.q === "string" ? params.q.trim() : "";

  const where: Prisma.PostWhereInput = {};
  if (q) where.title = { contains: q, mode: "insensitive" };
  if (state === "open") {
    where.deletedAt = null;
    where.takenDownAt = null;
    where.status = "OPEN";
  } else if (state === "resolved") {
    where.deletedAt = null;
    where.status = "RESOLVED";
  } else if (state === "taken_down") {
    where.deletedAt = null;
    where.takenDownAt = { not: null };
  } else if (state === "deleted") {
    where.deletedAt = { not: null };
  } else {
    where.deletedAt = null;
  }

  const posts = await prisma.post.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: 50,
    include: {
      author: { select: { nickname: true, department: true } },
      category: { select: { name: true } },
      takenDownBy: { select: { nickname: true } },
      _count: { select: { claims: true, images: true } },
    },
  });

  return (
    <div className="space-y-4">
      <form action="/admin/posts" method="get" className="flex flex-wrap gap-2">
        {state !== "all" ? <input type="hidden" name="state" value={state} /> : null}
        <input
          type="search"
          name="q"
          defaultValue={q}
          placeholder="按标题搜索"
          className="w-64 rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-sky-500"
        />
        <button
          type="submit"
          className="rounded-lg bg-slate-800 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700"
        >
          搜索
        </button>
      </form>

      <div className="flex flex-wrap gap-2 text-sm">
        {STATES.map((item) => (
          <Link
            key={item.key}
            href={buildHref(state, q, { state: item.key })}
            className={`rounded-lg border px-3 py-1.5 transition ${
              state === item.key
                ? "border-sky-500 bg-sky-50 text-sky-700"
                : "border-slate-200 bg-white text-slate-600 hover:border-sky-300"
            }`}
          >
            {item.label}
          </Link>
        ))}
      </div>

      {posts.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center text-sm text-slate-500">
          没有符合条件的信息。
        </p>
      ) : (
        <ul className="space-y-3">
          {posts.map((post) => (
            <li key={post.id} className="rounded-xl border border-slate-200 bg-white p-4">
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className={`rounded px-1.5 py-0.5 text-xs ${
                    post.type === "LOST" ? "bg-amber-50 text-amber-700" : "bg-teal-50 text-teal-700"
                  }`}
                >
                  {POST_TYPE_LABEL[post.type]}
                </span>
                <span className={`rounded px-1.5 py-0.5 text-xs ${POST_STATUS_STYLE[post.status]}`}>
                  {POST_STATUS_LABEL[post.status]}
                </span>
                {post.takenDownAt ? (
                  <span className="rounded bg-red-50 px-1.5 py-0.5 text-xs text-red-600">已下架</span>
                ) : null}
                {post.deletedAt ? (
                  <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-500">
                    已删除
                  </span>
                ) : null}
                <span className="text-xs text-slate-400">{formatRelative(post.createdAt)}</span>
              </div>

              <Link
                href={`/posts/${post.id}`}
                className="mt-2 block text-sm font-medium text-slate-900 hover:text-sky-700"
              >
                {post.title}
              </Link>

              <p className="mt-1 text-xs text-slate-500">
                {post.author.nickname}
                {post.author.department ? ` · ${post.author.department}` : ""} · {post.category.name} ·{" "}
                {post.location} · {formatDateTime(post.occurredAt)} · {post._count.images} 张图 ·{" "}
                {post._count.claims} 条认领
              </p>

              {post.takenDownAt ? (
                <p className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">
                  下架原因：{post.takeDownReason ?? "未填写"}
                  {post.takenDownBy ? ` · 操作人 ${post.takenDownBy.nickname}` : ""}
                </p>
              ) : null}

              <div className="mt-3 flex flex-wrap items-center gap-2">
                {post.deletedAt ? null : post.takenDownAt ? (
                  <form action={restorePostAction}>
                    <input type="hidden" name="postId" value={post.id} />
                    <button
                      type="submit"
                      className="rounded-lg border border-emerald-300 px-3 py-1.5 text-xs text-emerald-700 hover:bg-emerald-50"
                    >
                      恢复展示
                    </button>
                  </form>
                ) : (
                  <form action={takeDownPostAction} className="flex items-center gap-2">
                    <input type="hidden" name="postId" value={post.id} />
                    <input
                      type="text"
                      name="reason"
                      placeholder="下架原因"
                      className="w-40 rounded-lg border border-slate-300 px-2 py-1.5 text-xs outline-none focus:border-sky-500"
                    />
                    <button
                      type="submit"
                      className="rounded-lg border border-amber-300 px-3 py-1.5 text-xs text-amber-700 hover:bg-amber-50"
                    >
                      下架
                    </button>
                  </form>
                )}

                {post.deletedAt ? null : (
                  <form action={adminDeletePostAction}>
                    <input type="hidden" name="postId" value={post.id} />
                    <button
                      type="submit"
                      className="rounded-lg border border-red-200 px-3 py-1.5 text-xs text-red-600 hover:bg-red-50"
                    >
                      删除
                    </button>
                  </form>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
