import type { Metadata } from "next";
import Link from "next/link";
import type { Prisma } from "@prisma/client";
import {
  CLAIM_STATUS_LABEL,
  CLAIM_STATUS_STYLE,
  claimInclude,
  escalateOverdueClaims,
} from "@/lib/claims";
import { POST_TYPE_LABEL } from "@/lib/constants";
import { prisma } from "@/lib/db";
import { formatDateTime, formatRelative } from "@/lib/datetime";
import { requireAdmin } from "@/lib/session";

export const metadata: Metadata = { title: "认领处理 · 校园失物招领平台" };

const PAGE_SIZE = 20;

export default async function AdminClaimsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireAdmin();
  await escalateOverdueClaims();

  const params = await searchParams;
  const showAll = params.state === "all";
  const requestedPage = typeof params.page === "string" ? Number(params.page) : 1;
  const where: Prisma.ClaimWhereInput = showAll
    ? {}
    : { status: "PENDING", escalatedAt: { not: null } };

  const [total, pendingCount] = await Promise.all([
    prisma.claim.count({ where }),
    prisma.claim.count({ where: { status: "PENDING", escalatedAt: { not: null } } }),
  ]);
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const page = Number.isSafeInteger(requestedPage)
    ? Math.min(Math.max(1, requestedPage), totalPages)
    : 1;

  const claims = await prisma.claim.findMany({
    where,
    include: claimInclude,
    orderBy: showAll ? { createdAt: "desc" } : { escalatedAt: "asc" },
    skip: (page - 1) * PAGE_SIZE,
    take: PAGE_SIZE,
  });

  const pageHref = (target: number) =>
    `/admin/claims${showAll ? "?state=all" : ""}${target > 1 ? `${showAll ? "&" : "?"}page=${target}` : ""}`;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="section-heading text-lg font-bold">认领处理</h2>
          <p className="mt-1 text-sm text-slate-600">
            发布者超过 48 小时未处理的申请由管理员审核；当前待处理 {pendingCount} 条。
          </p>
        </div>
        <nav className="flex gap-2 text-sm" aria-label="认领记录筛选">
          <Link href="/admin/claims" className={`rounded-md border-2 px-3 py-1.5 ${!showAll ? "border-[#c86b52] bg-[#ffdfc7] text-[#8a3f35]" : "border-[#e2d5bd] bg-[#fffdf8] text-slate-700"}`}>
            待我处理 {pendingCount}
          </Link>
          <Link href="/admin/claims?state=all" className={`rounded-md border-2 px-3 py-1.5 ${showAll ? "border-[#c86b52] bg-[#ffdfc7] text-[#8a3f35]" : "border-[#e2d5bd] bg-[#fffdf8] text-slate-700"}`}>
            全部记录
          </Link>
        </nav>
      </div>

      {claims.length === 0 ? (
        <p className="paper-panel p-10 text-center text-sm text-slate-600">
          {showAll ? "暂无认领记录。" : "目前没有超时转交的认领申请。"}
        </p>
      ) : (
        <ul className="space-y-3">
          {claims.map((claim) => (
            <li key={claim.id}>
              <Link href={`/admin/claims/${claim.id}`} className="paper-panel surface-hover block p-4">
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <span className={`rounded px-2 py-0.5 ${CLAIM_STATUS_STYLE[claim.status]}`}>
                    {CLAIM_STATUS_LABEL[claim.status]}
                  </span>
                  {claim.status === "PENDING" ? (
                    <span className={`rounded px-2 py-0.5 ${claim.escalatedAt ? "bg-amber-100 text-amber-800" : "bg-slate-100 text-slate-600"}`}>
                      {claim.escalatedAt ? "已转交管理员" : "待发布者处理"}
                    </span>
                  ) : null}
                  <span className="text-slate-500">{POST_TYPE_LABEL[claim.post.type]}</span>
                  <span className="text-slate-500">申请于 {formatRelative(claim.createdAt)}</span>
                </div>
                <p className="mt-2 font-semibold text-slate-900">{claim.post.title}</p>
                <p className="mt-1 text-xs text-slate-600">
                  申请人 {claim.claimant.nickname} · 发布者 {claim.post.author.nickname}
                  {claim.escalatedAt ? ` · 转交于 ${formatDateTime(claim.escalatedAt)}` : ""}
                </p>
                <p className="mt-2 line-clamp-2 text-sm text-slate-600">{claim.message}</p>
                <span className="mt-2 inline-block text-xs font-semibold text-sky-700">查看凭证与处理 →</span>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {totalPages > 1 ? (
        <nav className="flex items-center justify-center gap-4 text-sm" aria-label="认领记录分页">
          {page > 1 ? <Link href={pageHref(page - 1)} className="text-sky-700 hover:underline">上一页</Link> : null}
          <span className="text-slate-600">第 {page} / {totalPages} 页</span>
          {page < totalPages ? <Link href={pageHref(page + 1)} className="text-sky-700 hover:underline">下一页</Link> : null}
        </nav>
      ) : null}
    </div>
  );
}
