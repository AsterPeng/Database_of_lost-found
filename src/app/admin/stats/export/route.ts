/**
 * 统计报表导出（CLFP-USR-0017）：按院系与时间段导出 CSV。
 * 与报表页面共用 computeStats，保证口径一致。
 */
import { requireAdmin } from "@/lib/session";
import { computeStats, normalizeRange, statsToCsv } from "@/lib/stats";

export async function GET(request: Request) {
  await requireAdmin();

  const url = new URL(request.url);
  const rangeKey = normalizeRange(url.searchParams.get("range") ?? undefined);
  const department = url.searchParams.get("department") ?? "";

  const stats = await computeStats(rangeKey, department);
  const csv = statsToCsv(stats);

  const stamp = new Date().toISOString().slice(0, 10);
  const filename = `失物招领统计-${stats.rangeKey}-${stamp}.csv`;

  return new Response(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
      "cache-control": "no-store",
    },
  });
}
