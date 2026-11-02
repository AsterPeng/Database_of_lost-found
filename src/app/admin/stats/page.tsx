import type { Metadata } from "next";
import Link from "next/link";
import { Card } from "@/components/ui";
import { computeStats, normalizeRange, STATS_RANGES, STATS_SCOPE_NOTE } from "@/lib/stats";

export const metadata: Metadata = { title: "统计报表 · 校园失物招领平台" };

function buildHref(range: string, department: string, overrides: Record<string, string> = {}) {
  const params = new URLSearchParams();
  const nextRange = overrides.range ?? range;
  const nextDepartment = overrides.department ?? department;
  if (nextRange && nextRange !== "30d") params.set("range", nextRange);
  if (nextDepartment) params.set("department", nextDepartment);
  const query = params.toString();
  return `/admin/stats${query ? `?${query}` : ""}`;
}

/** 统计报表（CLFP-USR-0017） */
export default async function AdminStatsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const rangeKey = normalizeRange(typeof params.range === "string" ? params.range : undefined);
  const department = typeof params.department === "string" ? params.department : "";

  const stats = await computeStats(rangeKey, department);
  const exportHref = `/admin/stats/export?range=${stats.rangeKey}${
    department ? `&department=${encodeURIComponent(department)}` : ""
  }`;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2 text-sm">
          {STATS_RANGES.map((item) => (
            <Link
              key={item.key}
              href={buildHref(rangeKey, department, { range: item.key })}
              className={`rounded-lg border px-3 py-1.5 transition ${
                rangeKey === item.key
                  ? "border-sky-500 bg-sky-50 text-sky-700"
                  : "border-slate-200 bg-white text-slate-600 hover:border-sky-300"
              }`}
            >
              {item.label}
            </Link>
          ))}
        </div>

        <Link
          href={exportHref}
          className="rounded-lg bg-slate-800 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700"
        >
          导出 CSV
        </Link>
      </div>

      <form action="/admin/stats" method="get" className="flex flex-wrap items-center gap-2">
        {rangeKey !== "30d" ? <input type="hidden" name="range" value={rangeKey} /> : null}
        <span className="text-sm text-slate-500">院系筛选</span>
        <select
          name="department"
          defaultValue={department}
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-sky-500"
        >
          <option value="">全部院系</option>
          {stats.departments.map((item) => (
            <option key={item} value={item}>
              {item}
            </option>
          ))}
        </select>
        <button
          type="submit"
          className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50"
        >
          应用
        </button>
        {department ? (
          <Link href={buildHref(rangeKey, "", { department: "" })} className="text-sm text-sky-600 hover:underline">
            清除筛选
          </Link>
        ) : null}
      </form>

      <p className="text-xs leading-6 text-slate-600">
        {STATS_SCOPE_NOTE}
      </p>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { label: "当前可用用户", value: stats.totals.users },
          { label: `新增注册（${stats.rangeLabel}）`, value: stats.totals.newUsers },
          { label: "发布量（未删除）", value: stats.totals.posts },
          { label: "其中已解决", value: stats.totals.resolved },
          { label: "找回率", value: `${stats.recoveryRate}%` },
          { label: "匹配量", value: stats.totals.matches },
          { label: "认领量", value: stats.totals.claims },
          { label: "其中已下架", value: stats.totals.takenDown },
        ].map((item) => (
          <div key={item.label} className="rounded-xl border border-slate-200 bg-white p-4">
            <p className="text-xs text-slate-500">{item.label}</p>
            <p className="mt-1 text-2xl font-semibold text-slate-900">{item.value}</p>
          </div>
        ))}
      </div>

      <Card title="按院系统计" description="用户按所属院系，发布按作者院系；没有发布记录的院系也会列出">
        {stats.byDepartment.length === 0 ? (
          <p className="text-sm text-slate-500">该范围内没有数据。</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] text-left text-sm">
              <thead className="border-b border-slate-200 text-xs text-slate-500">
                <tr>
                  <th className="py-2 font-medium">院系</th>
                  <th className="py-2 font-medium">当前可用用户</th>
                  <th className="py-2 font-medium">发布量（未删除）</th>
                  <th className="py-2 font-medium">其中已解决</th>
                  <th className="py-2 font-medium">找回率</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {stats.byDepartment.map((row) => (
                  <tr key={row.department}>
                    <td className="py-2 text-slate-800">{row.department}</td>
                    <td className="py-2 text-slate-600">{row.users}</td>
                    <td className="py-2 text-slate-600">{row.posts}</td>
                    <td className="py-2 text-slate-600">{row.resolved}</td>
                    <td className="py-2 text-slate-600">{row.recoveryRate}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card title="按类别统计">
        {stats.byCategory.length === 0 ? (
          <p className="text-sm text-slate-500">该范围内没有数据。</p>
        ) : (
          <ul className="space-y-2 text-sm">
            {stats.byCategory.map((row) => (
              <li key={row.category} className="flex items-center justify-between gap-3">
                <span className="text-slate-700">{row.category}</span>
                <span className="text-slate-500">
                  发布 {row.posts} 条 · 已解决 {row.resolved} 条
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
