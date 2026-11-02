import type { Metadata } from "next";
import { auditActionLabel, AUDIT_TARGET_LABEL } from "@/lib/audit";
import { prisma } from "@/lib/db";
import { formatDateTime } from "@/lib/datetime";

export const metadata: Metadata = { title: "操作日志 · 校园失物招领平台" };

/** 管理员操作日志（CLFP-USR-0016） */
export default async function AdminLogsPage() {
  const logs = await prisma.auditLog.findMany({
    orderBy: { createdAt: "desc" },
    take: 100,
    include: { operator: { select: { nickname: true, email: true } } },
  });

  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-500">
        记录最近 100 条管理操作。日志只增不改，用于事后追溯。
      </p>

      {logs.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center text-sm text-slate-500">
          还没有管理操作记录。
        </p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-xs text-slate-500">
              <tr>
                <th className="px-4 py-2 font-medium">时间</th>
                <th className="px-4 py-2 font-medium">操作人</th>
                <th className="px-4 py-2 font-medium">动作</th>
                <th className="px-4 py-2 font-medium">对象</th>
                <th className="px-4 py-2 font-medium">详情</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {logs.map((log) => {
                const detail = (log.detail ?? {}) as Record<string, unknown>;
                const summary =
                  typeof detail.title === "string"
                    ? detail.title
                    : typeof detail.name === "string"
                      ? detail.name
                      : detail.reset
                        ? "恢复默认配置"
                        : Object.keys(detail).length > 0
                          ? JSON.stringify(detail)
                          : "—";

                return (
                  <tr key={log.id}>
                    <td className="whitespace-nowrap px-4 py-2 text-xs text-slate-500">
                      {formatDateTime(log.createdAt)}
                    </td>
                    <td className="px-4 py-2 text-slate-800">
                      {log.operator?.nickname ?? "已注销"}
                    </td>
                    <td className="px-4 py-2">
                      <span className="rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-700">
                        {auditActionLabel(log.action)}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-xs text-slate-500">
                      {AUDIT_TARGET_LABEL[log.targetType] ?? log.targetType}
                    </td>
                    <td className="max-w-xs truncate px-4 py-2 text-xs text-slate-600" title={summary}>
                      {summary}
                      {typeof detail.reason === "string" ? `（原因：${detail.reason}）` : ""}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
