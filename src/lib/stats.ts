/**
 * 统计报表（CLFP-USR-0017）。
 * 页面与 CSV 导出共用这里的计算逻辑，保证两边口径一致。
 */
import type { Prisma } from "@prisma/client";
import { prisma } from "./db";

export const STATS_RANGES = [
  { key: "7d", label: "最近 7 天", days: 7 },
  { key: "30d", label: "最近 30 天", days: 30 },
  { key: "90d", label: "最近 90 天", days: 90 },
  { key: "all", label: "全部时间", days: null },
] as const;

export const STATS_SCOPE_NOTE =
  "当前可用用户为普通账号且状态正常；新增注册按注册时间计，包含之后被禁用或归档的账号。发布量仅排除已删除信息，下架和归档记录仍计入；已解决、已下架及找回率取所选时间内发布信息的当前状态。匹配按配对首次生成时间、认领按记录首次提交时间计，排除关联信息已删除的记录；重复认领复用原记录。筛选院系时，匹配或认领任一方属于该院系即计入一次。";

export type StatsRangeKey = (typeof STATS_RANGES)[number]["key"];

export type DepartmentRow = {
  department: string;
  users: number;
  posts: number;
  resolved: number;
  recoveryRate: number;
};

export type CategoryRow = {
  category: string;
  posts: number;
  resolved: number;
};

export type StatsResult = {
  rangeKey: StatsRangeKey;
  rangeLabel: string;
  since: Date | null;
  department: string;
  totals: {
    users: number;
    newUsers: number;
    posts: number;
    resolved: number;
    matches: number;
    claims: number;
    takenDown: number;
  };
  recoveryRate: number;
  byDepartment: DepartmentRow[];
  byCategory: CategoryRow[];
  departments: string[];
};

export function normalizeRange(value: string | undefined): StatsRangeKey {
  const found = STATS_RANGES.find((item) => item.key === value);
  return found?.key ?? "30d";
}

export async function computeStats(
  rangeKey: StatsRangeKey,
  department = "",
  now: Date = new Date(),
): Promise<StatsResult> {
  const range = STATS_RANGES.find((item) => item.key === rangeKey) ?? STATS_RANGES[1];
  const since = range.days ? new Date(now.getTime() - range.days * 24 * 60 * 60 * 1000) : null;

  const createdAt = since ? { gte: since, lte: now } : { lte: now };
  const userWhere: Prisma.UserWhereInput = {
    role: "USER",
    status: "ACTIVE",
    ...(department ? { department } : {}),
  };
  const postWhere: Prisma.PostWhereInput = {
    deletedAt: null,
    createdAt,
    ...(department ? { author: { department } } : {}),
  };
  const matchWhere: Prisma.MatchWhereInput = {
    createdAt,
    lostPost: { deletedAt: null },
    foundPost: { deletedAt: null },
    ...(department
      ? { OR: [{ lostPost: { author: { department } } }, { foundPost: { author: { department } } }] }
      : {}),
  };
  const claimWhere: Prisma.ClaimWhereInput = {
    createdAt,
    post: { deletedAt: null },
    ...(department
      ? { OR: [{ post: { author: { department } } }, { claimant: { department } }] }
      : {}),
  };

  const [users, newUsers, matches, claims, departmentsRaw, allPosts, departmentUsers] = await Promise.all([
    prisma.user.count({ where: userWhere }),
    prisma.user.count({
      where: { role: "USER", createdAt, ...(department ? { department } : {}) },
    }),
    prisma.match.count({ where: matchWhere }),
    prisma.claim.count({ where: claimWhere }),
    prisma.user.findMany({
      where: { role: "USER", department: { not: null } },
      distinct: ["department"],
      select: { department: true },
      orderBy: { department: "asc" },
    }),
    prisma.post.findMany({
      where: postWhere,
      select: {
        status: true,
        takenDownAt: true,
        author: { select: { department: true } },
        category: { select: { name: true } },
      },
    }),
    prisma.user.groupBy({
      by: ["department"],
      _count: { _all: true },
      where: userWhere,
    }),
  ]);

  const posts = allPosts.length;
  const takenDown = allPosts.filter((post) => post.takenDownAt !== null).length;
  const resolved = allPosts.filter((post) => post.status === "RESOLVED").length;
  const recoveryRate = allPosts.length === 0 ? 0 : Math.round((resolved / allPosts.length) * 100);

  // 按院系汇总
  const departmentMap = new Map<string, { posts: number; resolved: number }>();
  for (const post of allPosts) {
    const key = post.author.department ?? "未填写";
    const entry = departmentMap.get(key) ?? { posts: 0, resolved: 0 };
    entry.posts += 1;
    if (post.status === "RESOLVED") entry.resolved += 1;
    departmentMap.set(key, entry);
  }

  const userCountByDepartment = new Map(
    departmentUsers.map((item) => [item.department ?? "未填写", item._count._all]),
  );

  const byDepartment: DepartmentRow[] = [...new Set([
    ...userCountByDepartment.keys(),
    ...departmentMap.keys(),
  ])]
    .map((name) => {
      const value = departmentMap.get(name) ?? { posts: 0, resolved: 0 };
      return {
        department: name,
        users: userCountByDepartment.get(name) ?? 0,
        posts: value.posts,
        resolved: value.resolved,
        recoveryRate: value.posts === 0 ? 0 : Math.round((value.resolved / value.posts) * 100),
      };
    })
    .sort((a, b) => b.posts - a.posts || b.users - a.users || a.department.localeCompare(b.department, "zh-CN"));

  // 按类别汇总
  const categoryMap = new Map<string, { posts: number; resolved: number }>();
  for (const post of allPosts) {
    const key = post.category.name;
    const entry = categoryMap.get(key) ?? { posts: 0, resolved: 0 };
    entry.posts += 1;
    if (post.status === "RESOLVED") entry.resolved += 1;
    categoryMap.set(key, entry);
  }
  const byCategory: CategoryRow[] = [...categoryMap.entries()]
    .map(([category, value]) => ({ category, ...value }))
    .sort((a, b) => b.posts - a.posts);

  return {
    rangeKey: range.key,
    rangeLabel: range.label,
    since,
    department,
    totals: {
      users,
      newUsers,
      posts,
      resolved,
      matches,
      claims,
      takenDown,
    },
    recoveryRate,
    byDepartment,
    byCategory,
    departments: departmentsRaw
      .map((item) => item.department)
      .filter((value): value is string => Boolean(value)),
  };
}

function csvRow(...cells: Array<string | number>): string {
  return cells.map((cell) => {
    const raw = String(cell);
    const safe = typeof cell === "string" && /^\s*[=+\-@]/.test(raw) ? `'${raw}` : raw;
    return /[",\r\n]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
  }).join(",");
}

/** 生成 CSV 文本（带 BOM，便于 Excel 直接打开） */
export function statsToCsv(stats: StatsResult): string {
  const lines: string[] = [];

  lines.push(csvRow("校园失物招领平台 统计报表"));
  lines.push(csvRow("统计范围", stats.rangeLabel));
  lines.push(csvRow("院系筛选", stats.department || "全部"));
  lines.push(csvRow("生成时间", new Date().toLocaleString("zh-CN")));
  lines.push(csvRow("统计口径", STATS_SCOPE_NOTE));
  lines.push("");

  lines.push(csvRow("总体指标", "数值"));
  lines.push(csvRow("当前可用用户", stats.totals.users));
  lines.push(csvRow("新增注册", stats.totals.newUsers));
  lines.push(csvRow("发布量（未删除）", stats.totals.posts));
  lines.push(csvRow("其中已解决", stats.totals.resolved));
  lines.push(csvRow("找回率", `${stats.recoveryRate}%`));
  lines.push(csvRow("匹配量", stats.totals.matches));
  lines.push(csvRow("认领量", stats.totals.claims));
  lines.push(csvRow("其中已下架", stats.totals.takenDown));
  lines.push("");

  lines.push(csvRow("按院系统计"));
  lines.push(csvRow("院系", "当前可用用户", "发布量（未删除）", "其中已解决", "找回率"));
  for (const row of stats.byDepartment) {
    lines.push(csvRow(row.department, row.users, row.posts, row.resolved, `${row.recoveryRate}%`));
  }
  lines.push("");

  lines.push(csvRow("按类别统计"));
  lines.push(csvRow("类别", "发布量（未删除）", "其中已解决"));
  for (const row of stats.byCategory) {
    lines.push(csvRow(row.category, row.posts, row.resolved));
  }

  return `\uFEFF${lines.join("\r\n")}`;
}
