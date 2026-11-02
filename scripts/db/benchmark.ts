/**
 * P6 基准查询与索引对比。
 *
 * 用法（只允许 bench 库）：
 *   DATABASE_URL="postgresql://.../clfp_bench" npx tsx scripts/db/benchmark.ts
 *
 * 输出：
 *   - 控制台：各查询有/无索引的中位耗时
 *   - docs/database/assets/benchmark-explain.txt：完整 EXPLAIN (ANALYZE, BUFFERS)
 */
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { PrismaClient } from "@prisma/client";

const databaseUrl = process.env.DATABASE_URL ?? "";
if (!/bench/i.test(databaseUrl)) {
  console.error(
    "拒绝执行：benchmark 会在基准库上临时删除/重建索引，请把 DATABASE_URL 指向 clfp_bench。",
  );
  process.exit(1);
}

const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
const RUNS = 3;

type Measurement = {
  label: string;
  sql: string;
  ms: number;
  plan: string;
};

type Comparison = {
  label: string;
  withIndex: Measurement;
  withoutIndex: Measurement;
};

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? NaN;
}

async function measure(label: string, sql: string): Promise<Measurement> {
  const times: number[] = [];
  let plan = "";

  for (let run = 0; run < RUNS; run += 1) {
    const rows = await prisma.$queryRawUnsafe<Array<Record<string, string>>>(
      `EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT) ${sql}`,
    );
    plan = rows.map((row) => row["QUERY PLAN"]).join("\n");
    const match = plan.match(/Execution Time: ([0-9.]+) ms/);
    if (!match) {
      throw new Error(`无法从 EXPLAIN 输出解析 Execution Time：${label}`);
    }
    times.push(Number(match[1]));
  }

  return { label, sql, ms: median(times), plan };
}

async function indexExists(name: string): Promise<boolean> {
  const rows = await prisma.$queryRaw<Array<{ exists: boolean }>>`
    SELECT EXISTS (
      SELECT 1 FROM pg_indexes
      WHERE schemaname = 'public' AND indexname = ${name}
    ) AS exists
  `;
  return Boolean(rows[0]?.exists);
}

async function compareIndex(
  label: string,
  indexName: string,
  analyzeTable: string,
  createSql: string,
  querySql: string,
): Promise<Comparison> {
  if (!(await indexExists(indexName))) {
    await prisma.$executeRawUnsafe(createSql);
  }
  await prisma.$executeRawUnsafe(`ANALYZE ${analyzeTable}`);

  const withIndex = await measure(`${label}（有索引）`, querySql);

  await prisma.$executeRawUnsafe(`DROP INDEX IF EXISTS ${indexName}`);
  const withoutIndex = await measure(`${label}（无索引）`, querySql);

  await prisma.$executeRawUnsafe(createSql);
  await prisma.$executeRawUnsafe(`ANALYZE ${analyzeTable}`);

  return { label, withIndex, withoutIndex };
}

async function main() {
  console.log("P6 基准查询开始");

  const refreshStart = performance.now();
  await prisma.$executeRawUnsafe("DO $$ BEGIN PERFORM fn_refresh_stats_mv(); END $$");
  const refreshMs = performance.now() - refreshStart;
  console.log(`物化视图刷新完成，耗时 ${refreshMs.toFixed(2)} ms`);

  const comparisons: Comparison[] = [];

  comparisons.push(
    await compareIndex(
      "公开信息流（LOST + 时间倒序 + LIMIT 12）",
      "posts_public_feed_idx",
      "posts",
      "CREATE INDEX posts_public_feed_idx ON posts (type, created_at DESC) WHERE deleted_at IS NULL AND taken_down_at IS NULL AND archived_at IS NULL",
      `SELECT id, title, created_at
       FROM posts
       WHERE type = 'LOST'
         AND deleted_at IS NULL
         AND taken_down_at IS NULL
         AND archived_at IS NULL
       ORDER BY created_at DESC
       LIMIT 12`,
    ),
  );

  comparisons.push(
    await compareIndex(
      "中文关键词搜索（title ILIKE '%稀有物品%'）",
      "posts_title_trgm_idx",
      "posts",
      "CREATE INDEX posts_title_trgm_idx ON posts USING gin (title gin_trgm_ops)",
      `SELECT id, title
       FROM posts
       WHERE deleted_at IS NULL
         AND taken_down_at IS NULL
         AND archived_at IS NULL
         AND title ILIKE '%稀有物品%'
       ORDER BY created_at DESC
       LIMIT 20`,
    ),
  );

  comparisons.push(
    await compareIndex(
      "待审认领队列（PENDING + 按 escalate_at）",
      "claims_pending_escalate_idx",
      "claims",
      "CREATE INDEX claims_pending_escalate_idx ON claims (escalate_at) WHERE status = 'PENDING' AND escalated_at IS NULL",
      `SELECT id, escalate_at
       FROM claims
       WHERE status = 'PENDING'
         AND escalated_at IS NULL
       ORDER BY escalate_at
       LIMIT 20`,
    ),
  );

  comparisons.push(
    await compareIndex(
      "未读通知计数（单用户）",
      "notifications_unread_idx",
      "notifications",
      "CREATE INDEX notifications_unread_idx ON notifications (user_id) WHERE read_at IS NULL",
      `SELECT count(*)::int AS n
       FROM notifications
       WHERE user_id = 'bench-u-000042'
         AND read_at IS NULL
         AND deliver_at <= (now() AT TIME ZONE 'UTC')`,
    ),
  );

  const stats = await measure(
    "统计函数 fn_stats（全部时间）",
    `SELECT fn_stats(NULL::timestamptz, NULL::timestamptz, NULL::text) AS stats`,
  );

  const stats30d = await measure(
    "统计函数 fn_stats（最近 30 天）",
    `SELECT fn_stats(
       (now() - interval '30 days')::timestamptz,
       now(),
       NULL::text
     ) AS stats`,
  );

  const mvDepartment = await measure(
    "院系物化视图（全部时间）",
    `SELECT department, users, posts, resolved, recovery_rate
     FROM mv_stats_department
     ORDER BY posts DESC, users DESC`,
  );

  const mvCategory = await measure(
    "类别物化视图（全部时间）",
    `SELECT category, posts, resolved, recovery_rate
     FROM mv_stats_category
     ORDER BY posts DESC`,
  );

  const matchCandidates = await measure(
    "匹配候选（feedback = NONE + 时间倒序）",
    `SELECT id, score, created_at
     FROM matches
     WHERE feedback = 'NONE'
     ORDER BY created_at DESC
     LIMIT 20`,
  );

  console.log("\n索引对比结果（单位：毫秒，3 次中位数）");
  console.table(
    comparisons.map((item) => ({
      查询: item.label,
      有索引: Number(item.withIndex.ms.toFixed(2)),
      无索引: Number(item.withoutIndex.ms.toFixed(2)),
      提升倍数:
        item.withoutIndex.ms > 0
          ? Number((item.withoutIndex.ms / Math.max(item.withIndex.ms, 0.01)).toFixed(2))
          : null,
    })),
  );

  console.log("\n无索引对照 / 其他基准查询");
  console.table([
    { 查询: stats.label, 耗时毫秒: Number(stats.ms.toFixed(2)) },
    { 查询: stats30d.label, 耗时毫秒: Number(stats30d.ms.toFixed(2)) },
    { 查询: mvDepartment.label, 耗时毫秒: Number(mvDepartment.ms.toFixed(2)) },
    { 查询: mvCategory.label, 耗时毫秒: Number(mvCategory.ms.toFixed(2)) },
    { 查询: matchCandidates.label, 耗时毫秒: Number(matchCandidates.ms.toFixed(2)) },
  ]);
  console.log(`物化视图刷新耗时：${refreshMs.toFixed(2)} ms（刷新后可重复查询，适合全量总览）`);

  const sections: string[] = [
    "# P6 基准查询 EXPLAIN 输出",
    "",
    `生成时间：${new Date().toISOString()}`,
    "",
  ];

  for (const item of comparisons) {
    sections.push(
      `## ${item.label}`,
      "",
      `### 有索引（${item.withIndex.ms.toFixed(2)} ms）`,
      "```text",
      item.withIndex.plan,
      "```",
      "",
      `### 无索引（${item.withoutIndex.ms.toFixed(2)} ms）`,
      "```text",
      item.withoutIndex.plan,
      "```",
      "",
    );
  }

  sections.push(
    `## ${stats.label}（${stats.ms.toFixed(2)} ms）`,
    "```text",
    stats.plan,
    "```",
    "",
    `## ${stats30d.label}（${stats30d.ms.toFixed(2)} ms）`,
    "```text",
    stats30d.plan,
    "```",
    "",
    `## ${mvDepartment.label}（${mvDepartment.ms.toFixed(2)} ms）`,
    "```text",
    mvDepartment.plan,
    "```",
    "",
    `## ${mvCategory.label}（${mvCategory.ms.toFixed(2)} ms）`,
    "```text",
    mvCategory.plan,
    "```",
    "",
    `## 物化视图刷新（${refreshMs.toFixed(2)} ms）`,
    "`SELECT fn_refresh_stats_mv()` 的刷新耗时见基准输出；全量总览查询应优先读物化视图。",
    "",
    `## ${matchCandidates.label}（${matchCandidates.ms.toFixed(2)} ms）`,
    "```text",
    matchCandidates.plan,
    "```",
    "",
  );

  const outputPath = resolve(process.cwd(), "docs/database/assets/benchmark-explain.txt");
  writeFileSync(outputPath, sections.join("\n"), "utf8");
  console.log(`\n完整 EXPLAIN 输出已写入 ${outputPath}`);
  console.log("P6 基准查询完成");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });