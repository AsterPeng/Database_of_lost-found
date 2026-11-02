/**
 * P6 基准数据生成：调用 db/sql/07_benchmark_data.sql。
 *
 * 用法（只允许 bench 库）：
 *   DATABASE_URL="postgresql://.../clfp_bench" npx tsx scripts/db/generate-data.ts
 */
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { PrismaClient } from "@prisma/client";

const databaseUrl = process.env.DATABASE_URL ?? "";
if (!/bench/i.test(databaseUrl)) {
  console.error(
    "拒绝执行：generate-data 会写入大量数据，请把 DATABASE_URL 指向基准库（例如 clfp_bench）。",
  );
  process.exit(1);
}

const psql = process.env.PSQL_PATH ?? "D:\\Program Files\\PostgreSQL\\18\\bin\\psql.exe";
const sqlPath = resolve(process.cwd(), "db/sql/07_benchmark_data.sql");

// psql 不接受 Prisma 的 ?schema=public 查询参数，去掉查询串
const psqlUrl = new URL(databaseUrl);
psqlUrl.search = "";

async function main() {
  console.log("开始生成基准数据：10 万用户 / 10 万帖子 / 10 万匹配 / 10 万认领 / 10 万通知");
  const result = spawnSync(
    psql,
    ["-v", "ON_ERROR_STOP=1", "-d", psqlUrl.toString(), "-f", sqlPath],
    { stdio: "inherit" },
  );

  if (result.error) {
    console.error("无法启动 psql：", result.error.message);
    process.exit(1);
  }
  if (result.status !== 0) {
    console.error(`psql 退出码 ${result.status}，生成失败`);
    process.exit(result.status ?? 1);
  }

  const prisma = new PrismaClient();
  try {
    const [users, posts, matches, claims, notifications] = await Promise.all([
      prisma.user.count({ where: { id: { startsWith: "bench-u-" } } }),
      prisma.post.count({ where: { id: { startsWith: "bench-p-" } } }),
      prisma.match.count({ where: { id: { startsWith: "bench-m-" } } }),
      prisma.claim.count({ where: { id: { startsWith: "bench-c-" } } }),
      prisma.notification.count({ where: { id: { startsWith: "bench-n-" } } }),
    ]);

    console.log("基准数据核对：");
    console.log(`  用户   ${users}`);
    console.log(`  帖子   ${posts}`);
    console.log(`  匹配   ${matches}`);
    console.log(`  认领   ${claims}`);
    console.log(`  通知   ${notifications}`);

    if (
      users !== 100000 ||
      posts !== 100000 ||
      matches !== 100000 ||
      claims !== 100000 ||
      notifications !== 100000
    ) {
      console.error("数据量与预期不一致，请检查生成 SQL");
      process.exitCode = 1;
    } else {
      console.log("P6 基准数据生成完成");
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});