/**
 * P3 统计口径对比：computeStatsLegacy（Node 内存聚合） vs computeStats（fn_stats）。
 *
 * 用法（在测试库上运行，不碰展示库）：
 *   DATABASE_URL="postgresql://.../clfp_test" npx tsx scripts/db/verify-stats-parity.ts
 *
 * 脚本会创建一组带唯一前缀的测试数据，覆盖：
 *   - 7 天 / 30 天 / 90 天 / 全部时间
 *   - 院系筛选与空院系
 *   - 已解决、下架、删除、归档帖子
 *   - 关联已删除帖子的匹配与认领（应被排除）
 * 比较完成后删除测试数据。
 */
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import {
  computeStats,
  computeStatsLegacy,
  STATS_RANGES,
  type StatsRangeKey,
  type StatsResult,
} from "../../src/lib/stats";

const prisma = new PrismaClient();

// 防止误在展示库上运行：只允许数据库名包含 test 的连接串
if (!/test/i.test(process.env.DATABASE_URL ?? "")) {
  console.error(
    "拒绝执行：verify-stats-parity 会创建临时数据，请把 DATABASE_URL 指向测试库（例如 clfp_test）。",
  );
  process.exit(1);
}

const suffix = randomBytes(5).toString("hex");
const now = new Date();
const daysAgo = (days: number) => new Date(now.getTime() - days * 24 * 60 * 60 * 1000);

const departmentA = `Parity-A-${suffix}`;
const departmentB = `Parity-B-${suffix}`;
const userIds: string[] = [];
let categoryId: string | undefined;

function normalize(stats: StatsResult) {
  const byDepartment = [...stats.byDepartment]
    .sort((a, b) => a.department.localeCompare(b.department, "zh-CN"))
    .map((row) => ({
      department: row.department,
      users: row.users,
      posts: row.posts,
      resolved: row.resolved,
      recoveryRate: row.recoveryRate,
    }));
  const byCategory = [...stats.byCategory]
    .sort((a, b) => a.category.localeCompare(b.category, "zh-CN"))
    .map((row) => ({
      category: row.category,
      posts: row.posts,
      resolved: row.resolved,
    }));

  return {
    rangeKey: stats.rangeKey,
    rangeLabel: stats.rangeLabel,
    since: stats.since?.toISOString() ?? null,
    department: stats.department,
    totals: stats.totals,
    recoveryRate: stats.recoveryRate,
    byDepartment,
    byCategory,
    departments: [...stats.departments].sort((a, b) => a.localeCompare(b, "zh-CN")),
  };
}

async function createUser(label: string, department: string | null, createdAt: Date) {
  const user = await prisma.user.create({
    data: {
      email: `parity-${label}-${suffix}@example.invalid`,
      passwordHash: "temporary-parity-account",
      nickname: `Parity ${label}`,
      department,
      role: "USER",
      status: "ACTIVE",
      profileCompleted: true,
      createdAt,
    },
  });
  userIds.push(user.id);
  return user;
}

async function main() {
  try {
    const category = await prisma.category.create({
      data: { name: `Parity Category ${suffix}` },
    });
    categoryId = category.id;

    const recent = daysAgo(3);
    const middle = daysAgo(45);
    const old = daysAgo(100);

    const u1 = await createUser("a", departmentA, recent);
    const u2 = await createUser("b", departmentB, middle);
    const u3 = await createUser("null", null, recent);
    const u4 = await createUser("old", departmentA, old);

    const post = (
      authorId: string,
      type: "LOST" | "FOUND",
      title: string,
      createdAt: Date,
      extras: Record<string, unknown> = {},
    ) =>
      prisma.post.create({
        data: {
          authorId,
          type,
          title,
          description: "Parity verification post",
          categoryId: category.id,
          location: "Library",
          occurredAt: createdAt,
          createdAt,
          ...extras,
        },
      });

    const p1 = await post(u1.id, "LOST", `Parity-LOST-${suffix}`, recent);
    const p2 = await post(u2.id, "FOUND", `Parity-FOUND-${suffix}`, recent, {
      status: "RESOLVED",
      resolvedAt: recent,
    });
    const p3 = await post(u3.id, "LOST", `Parity-NULLDEPT-${suffix}`, middle);
    const p4 = await post(u4.id, "FOUND", `Parity-DELETED-${suffix}`, recent, {
      deletedAt: now,
    });
    await post(u1.id, "LOST", `Parity-DOWN-${suffix}`, recent, {
      takenDownAt: recent,
    });
    const p6 = await post(u2.id, "FOUND", `Parity-ARCHIVED-${suffix}`, recent, {
      archivedAt: recent,
    });

    const match = (lostPostId: string, foundPostId: string, createdAt: Date) =>
      prisma.match.create({
        data: {
          lostPostId,
          foundPostId,
          score: 0.8,
          detail: {},
          createdAt,
        },
      });

    await match(p1.id, p2.id, recent);
    await match(p3.id, p6.id, middle);
    // 关联已删除帖子，统计时应排除
    await match(p1.id, p4.id, recent);

    const claim = (postId: string, claimantId: string, createdAt: Date) =>
      prisma.claim.create({
        data: {
          postId,
          claimantId,
          message: "Parity verification claim",
          proof: "Parity unique feature",
          contactEncrypted: "parity-placeholder",
          contactMasked: "parity****only",
          escalateAt: new Date(createdAt.getTime() + 48 * 60 * 60 * 1000),
          createdAt,
        },
      });

    await claim(p1.id, u2.id, recent);
    // 关联已删除帖子，统计时应排除
    await claim(p4.id, u1.id, recent);
    await claim(p3.id, u4.id, middle);

    const departments = ["", departmentA, departmentB];
    let checked = 0;

    for (const range of STATS_RANGES.map((item) => item.key) as StatsRangeKey[]) {
      for (const department of departments) {
        const legacy = await computeStatsLegacy(range, department, now);
        const sql = await computeStats(range, department, now);
        assert.deepEqual(
          normalize(sql),
          normalize(legacy),
          `stats parity failed: range=${range}, department=${department || "(all)"}`,
        );
        checked += 1;
      }
    }

    console.log(`统计口径对比通过：${checked} 组（4 个时间范围 × 3 种院系筛选）`);
  } finally {
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    if (categoryId) {
      await prisma.category.delete({ where: { id: categoryId } }).catch(() => undefined);
    }
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});