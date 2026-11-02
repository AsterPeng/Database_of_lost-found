/**
 * 向量化 worker：处理 embedding_tasks 里待办的任务。
 *
 * 用法：
 *   npm run worker            # 常驻，轮询处理
 *   npm run worker -- --once  # 处理完当前积压后退出（适合批量补算）
 *   npm run rag:rebuild       # 全部帖子重新向量化并重算匹配
 */
import "./_env";
import { prisma } from "../src/lib/db";
import { processPendingTasks, processPostPipeline } from "../src/lib/rag/pipeline";

const once = process.argv.includes("--once");
const rebuild = process.argv.includes("--rebuild");
const intervalMs = Number(process.env.WORKER_INTERVAL_MS ?? "5000");

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  if (rebuild) {
    const posts = await prisma.post.findMany({
      where: { deletedAt: null },
      select: { id: true, title: true },
      orderBy: { createdAt: "asc" },
    });
    console.log(`开始重建 ${posts.length} 条帖子的向量与匹配…`);

    let done = 0;
    for (const post of posts) {
      const result = await processPostPipeline(post.id, { recomputeFromScratch: true });
      done += 1;
      const status = result.embedded ? `向量已生成（${result.model}），匹配 ${result.matches} 条` : `失败：${result.error}`;
      console.log(`  [${done}/${posts.length}] ${post.title} → ${status}`);
    }

    console.log("重建完成。");
    return;
  }

  console.log(`worker 已启动（${once ? "单次模式" : `每 ${intervalMs}ms 轮询一次`}）`);

  do {
    const processed = await processPendingTasks(10);
    if (processed > 0) {
      console.log(`处理了 ${processed} 条向量化任务（${new Date().toLocaleTimeString("zh-CN")}）`);
      continue;
    }
    if (once) break;
    await sleep(intervalMs);
  } while (true);

  console.log("worker 退出。");
}

main()
  .catch((error) => {
    console.error("worker 异常：", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
