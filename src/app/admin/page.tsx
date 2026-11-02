import type { Metadata } from "next";
import Link from "next/link";
import { Card } from "@/components/ui";
import { escalateOverdueClaims } from "@/lib/claims";
import { prisma } from "@/lib/db";
import { formatRelative } from "@/lib/datetime";
import { getRagConfig } from "@/lib/rag/config";
import { computeStats } from "@/lib/stats";

export const metadata: Metadata = { title: "管理概览 · 校园失物招领平台" };

export default async function AdminOverviewPage() {
  await escalateOverdueClaims();
  const now = new Date();
  const since = new Date(now.getTime() - 24 * 60 * 60 * 1000);

  const [
    stats,
    openCount,
    pendingClaims,
    newPostsToday,
    config,
    recentLogs,
  ] = await Promise.all([
    computeStats("all", "", now),
    prisma.post.count({ where: { deletedAt: null, takenDownAt: null, archivedAt: null, status: "OPEN" } }),
    prisma.claim.count({ where: { status: "PENDING", escalatedAt: { not: null } } }),
    prisma.post.count({ where: { deletedAt: null, createdAt: { gte: since, lte: now } } }),
    getRagConfig(),
    prisma.auditLog.findMany({
      orderBy: { createdAt: "desc" },
      take: 6,
      include: { operator: { select: { nickname: true } } },
    }),
  ]);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { label: "当前可用用户", value: stats.totals.users },
          { label: "信息总数（未删除）", value: stats.totals.posts },
          { label: "寻找中", value: openCount },
          { label: "已解决", value: stats.totals.resolved },
          { label: "匹配记录", value: stats.totals.matches },
          { label: "待处理认领", value: pendingClaims, href: "/admin/claims" },
          { label: "已下架", value: stats.totals.takenDown },
          { label: "24 小时新发布", value: newPostsToday },
        ].map((item) => (
          item.href ? (
            <Link key={item.label} href={item.href} className="paper-panel surface-hover block p-4">
              <p className="text-xs text-slate-500">{item.label} · 超时转交</p>
              <p className="mt-1 text-2xl font-semibold text-slate-900">{item.value}</p>
              <p className="mt-1 text-xs text-sky-700">进入处理 →</p>
            </Link>
          ) : (
            <div key={item.label} className="paper-panel p-4">
              <p className="text-xs text-slate-500">{item.label}</p>
              <p className="mt-1 text-2xl font-semibold text-slate-900">{item.value}</p>
            </div>
          )
        ))}
      </div>

      <Card title="找回率" description="当前已解决的未删除信息 / 未删除信息总数；与统计报表的全部时间口径一致">
        <div className="flex items-center gap-4">
          <div className="h-3 flex-1 overflow-hidden rounded-full bg-slate-100">
            <div className="h-full rounded-full bg-emerald-500" style={{ width: `${stats.recoveryRate}%` }} />
          </div>
          <span className="text-lg font-semibold text-slate-900">{stats.recoveryRate}%</span>
        </div>
      </Card>

      <Card title="当前匹配配置" description="可在配置中心调整，无需修改代码">
        <ul className="grid grid-cols-2 gap-y-2 text-sm text-slate-600 sm:grid-cols-3">
          <li>向量模型：{config.provider === "mock" ? "本地降级模式" : config.provider}</li>
          <li>匹配阈值：{config.threshold}</li>
          <li>每条最多推荐：{config.maxMatches}</li>
          <li>时间窗：{config.windowDays} 天</li>
          <li>向量权重：{config.weights.vector}</li>
          <li>关键词权重：{config.weights.keyword}</li>
        </ul>
        <Link href="/admin/config" className="mt-3 inline-block text-sm text-sky-600 hover:underline">
          去调整配置 →
        </Link>
      </Card>

      <Card title="最近的管理操作">
        {recentLogs.length === 0 ? (
          <p className="text-sm text-slate-500">还没有管理操作记录。</p>
        ) : (
          <ul className="space-y-2 text-sm">
            {recentLogs.map((log) => (
              <li key={log.id} className="flex items-center justify-between gap-3">
                <span className="text-slate-700">
                  {log.operator?.nickname ?? "已注销"} · {log.action}
                </span>
                <span className="text-xs text-slate-400">{formatRelative(log.createdAt)}</span>
              </li>
            ))}
          </ul>
        )}
        <Link href="/admin/logs" className="mt-3 inline-block text-sm text-sky-600 hover:underline">
          查看全部日志 →
        </Link>
      </Card>
    </div>
  );
}
