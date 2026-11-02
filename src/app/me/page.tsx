import type { Metadata } from "next";
import Link from "next/link";
import { Card } from "@/components/ui";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/session";

export const metadata: Metadata = { title: "我的 · 校园失物招领平台" };

export default async function MePage() {
  const user = await requireUser();

  const [openCount, resolvedCount, totalCount, matchCount, pendingClaims, myClaimCount] =
    await Promise.all([
      prisma.post.count({ where: { authorId: user.id, deletedAt: null, status: "OPEN" } }),
      prisma.post.count({ where: { authorId: user.id, deletedAt: null, status: "RESOLVED" } }),
      prisma.post.count({ where: { authorId: user.id, deletedAt: null } }),
      prisma.match.count({
        where: {
          feedback: { not: "NOT_MINE" },
          OR: [{ lostPost: { authorId: user.id } }, { foundPost: { authorId: user.id } }],
        },
      }),
      prisma.claim.count({ where: { post: { authorId: user.id }, status: "PENDING" } }),
      prisma.claim.count({ where: { claimantId: user.id } }),
    ]);

  const rows: { label: string; value: string }[] = [
    { label: "昵称", value: user.nickname },
    { label: "邮箱", value: user.email },
    { label: "真实姓名", value: user.realName ?? "未填写" },
    { label: "学号 / 工号", value: user.studentNo ?? "未填写" },
    { label: "所属院系", value: user.department ?? "未填写" },
    { label: "手机号", value: user.phoneMasked ?? "未填写" },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="section-heading text-2xl font-bold text-slate-900">我的</h1>
          <p className="mt-1 text-sm text-slate-500">账号与校内身份资料概览。</p>
        </div>
        <Link
          href="/settings"
          className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50"
        >
          编辑资料
        </Link>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { label: "我的发布", value: totalCount, href: "/me/posts" },
          { label: "寻找中", value: openCount, href: "/me/posts?status=OPEN" },
          { label: "已解决", value: resolvedCount, href: "/me/posts?status=RESOLVED" },
          { label: "匹配推荐", value: matchCount, href: "/me/matches" },
        ].map((item) => (
          <Link
            key={item.label}
            href={item.href}
            className="surface-hover paper-panel p-4"
          >
            <p className="text-xs text-slate-500">{item.label}</p>
            <p className="mt-1 text-2xl font-semibold text-slate-900">{item.value}</p>
          </Link>
        ))}
      </div>

      {pendingClaims > 0 ? (
        <Link
          href="/me/claims"
          className="flex items-center justify-between rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 transition hover:border-amber-300"
        >
          <span className="text-sm text-amber-900">
            有 <span className="font-semibold">{pendingClaims}</span> 条认领申请等待你处理
            （48 小时内未处理将自动转交管理员）
          </span>
          <span className="text-sm text-amber-700">去处理 →</span>
        </Link>
      ) : null}

      {myClaimCount > 0 ? (
        <p className="text-sm text-slate-500">
          你发起过 {myClaimCount} 条认领申请，
          <Link href="/me/claims" className="text-sky-600 hover:underline">
            查看进度
          </Link>
        </p>
      ) : null}

      <Card>
        <dl className="divide-y divide-slate-100">
          {rows.map((row) => (
            <div key={row.label} className="flex items-center justify-between gap-4 py-3">
              <dt className="text-sm text-slate-500">{row.label}</dt>
              <dd className="text-sm font-medium text-slate-900">{row.value}</dd>
            </div>
          ))}
        </dl>
      </Card>

    </div>
  );
}
