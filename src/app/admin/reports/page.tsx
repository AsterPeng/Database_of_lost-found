import type { Metadata } from "next";
import Link from "next/link";
import { REPORT_STATUS_LABEL, REPORT_STATUS_STYLE } from "@/lib/reports";
import { prisma } from "@/lib/db";
import { formatDateTime, formatRelative } from "@/lib/datetime";
import { handleReportAction } from "@/server/report-actions";

export const metadata: Metadata = { title: "举报处理 · 校园失物招领平台" };

const FILTERS = [
  { key: "pending", label: "待处理" },
  { key: "all", label: "全部" },
] as const;

/** 举报处理队列（CLFP-USR-0015） */
export default async function AdminReportsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const filter = params.state === "all" ? "all" : "pending";

  const reports = await prisma.report.findMany({
    where: filter === "pending" ? { status: "PENDING" } : {},
    orderBy: { createdAt: "desc" },
    take: 50,
    include: {
      reporter: { select: { nickname: true } },
      handledBy: { select: { nickname: true } },
    },
  });

  const postIds = [...new Set(reports.map((report) => report.targetId))];
  const posts = await prisma.post.findMany({
    where: { id: { in: postIds } },
    select: { id: true, title: true, takenDownAt: true, deletedAt: true },
  });
  const postMap = new Map(posts.map((post) => [post.id, post]));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2 text-sm">
        {FILTERS.map((item) => (
          <Link
            key={item.key}
            href={item.key === "pending" ? "/admin/reports" : "/admin/reports?state=all"}
            className={`rounded-lg border px-3 py-1.5 transition ${
              filter === item.key
                ? "border-sky-500 bg-sky-50 text-sky-700"
                : "border-slate-200 bg-white text-slate-600 hover:border-sky-300"
            }`}
          >
            {item.label}
          </Link>
        ))}
      </div>

      {reports.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center text-sm text-slate-500">
          {filter === "pending" ? "当前没有待处理的举报。" : "还没有举报记录。"}
        </p>
      ) : (
        <ul className="space-y-3">
          {reports.map((report) => {
            const post = postMap.get(report.targetId);
            return (
              <li key={report.id} className="rounded-xl border border-slate-200 bg-white p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`rounded px-2 py-0.5 text-xs ${REPORT_STATUS_STYLE[report.status]}`}>
                    {REPORT_STATUS_LABEL[report.status]}
                  </span>
                  <span className="rounded bg-red-50 px-2 py-0.5 text-xs text-red-600">
                    {report.reason}
                  </span>
                  <span className="text-xs text-slate-400">{formatRelative(report.createdAt)}</span>
                  <span className="text-xs text-slate-500">举报人 {report.reporter.nickname}</span>
                </div>

                <p className="mt-2 text-sm text-slate-900">
                  被举报信息：
                  {post ? (
                    <Link href={`/posts/${post.id}`} className="text-sky-700 hover:underline">
                      {post.title}
                    </Link>
                  ) : (
                    <span className="text-slate-400">已被删除</span>
                  )}
                  {post?.takenDownAt ? (
                    <span className="ml-2 rounded bg-red-50 px-2 py-0.5 text-xs text-red-600">
                      已下架
                    </span>
                  ) : null}
                </p>

                {report.detail ? (
                  <p className="mt-2 whitespace-pre-wrap rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-600">
                    {report.detail}
                  </p>
                ) : null}

                {report.status === "PENDING" ? (
                  <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    <form action={handleReportAction} className="space-y-2">
                      <input type="hidden" name="reportId" value={report.id} />
                      <input type="hidden" name="decision" value="RESOLVE" />
                      <label className="flex items-center gap-2 text-xs text-slate-600">
                        <input type="checkbox" name="takeDown" defaultChecked className="h-3.5 w-3.5" />
                        同时下架该信息
                      </label>
                      <input
                        type="text"
                        name="note"
                        placeholder="处理备注（可选）"
                        className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-xs outline-none focus:border-sky-500"
                      />
                      <button
                        type="submit"
                        className="w-full rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700"
                      >
                        受理举报
                      </button>
                    </form>

                    <form action={handleReportAction} className="space-y-2">
                      <input type="hidden" name="reportId" value={report.id} />
                      <input type="hidden" name="decision" value="REJECT" />
                      <input
                        type="text"
                        name="note"
                        placeholder="驳回理由（可选）"
                        className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-xs outline-none focus:border-sky-500"
                      />
                      <button
                        type="submit"
                        className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-50"
                      >
                        驳回举报
                      </button>
                    </form>
                  </div>
                ) : (
                  <p className="mt-3 text-xs text-slate-500">
                    {REPORT_STATUS_LABEL[report.status]}
                    {report.handledBy ? ` · 处理人 ${report.handledBy.nickname}` : ""}
                    {report.handledAt ? ` · ${formatDateTime(report.handledAt)}` : ""}
                    {report.handleNote ? ` · 备注：${report.handleNote}` : ""}
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
