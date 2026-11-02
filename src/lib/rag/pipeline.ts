/**
 * 向量化流水线（CLFP-USR-0020）。
 *
 * 设计：发布接口只负责入队（embedding_tasks），真正的向量化与匹配由
 * processPostPipeline / worker 完成。默认在发布请求内同步执行一次，
 * 这样无需额外进程就能演示完整链路；同时保留 worker 用于批量补算与重建。
 */
import { prisma } from "../db";
import { getRagConfig } from "./config";
import { buildEmbeddingText, clearStaleMatches, runMatchingFor } from "./matching";
import { embedWithFallback } from "./providers";

export type PipelineResult = {
  embedded: boolean;
  model: string;
  dim: number;
  usedFallback: boolean;
  matches: number;
  error?: string;
};

/** 入队一条向量化任务（同一帖子已存在未完成任务时复用） */
export async function enqueueEmbeddingTask(postId: string): Promise<string> {
  const pending = await prisma.embeddingTask.findFirst({
    where: { postId, status: { in: ["PENDING", "FAILED"] } },
    orderBy: { createdAt: "desc" },
  });

  if (pending) {
    await prisma.embeddingTask.update({
      where: { id: pending.id },
      data: { status: "PENDING", error: null },
    });
    return pending.id;
  }

  const task = await prisma.embeddingTask.create({ data: { postId } });
  return task.id;
}

/**
 * 处理一条帖子：向量化 + 写入向量 + 计算匹配。
 * 整个过程不抛异常——模型服务故障只会让向量回退到本地实现，不影响发布。
 */
export async function processPostPipeline(
  postId: string,
  options: { recomputeFromScratch?: boolean } = {},
): Promise<PipelineResult> {
  const taskId = await enqueueEmbeddingTask(postId);

  const fail = async (error: string): Promise<PipelineResult> => {
    await prisma.embeddingTask.update({
      where: { id: taskId },
      data: { status: "FAILED", error, attempts: { increment: 1 } },
    });
    return { embedded: false, model: "", dim: 0, usedFallback: false, matches: 0, error };
  };

  try {
    const post = await prisma.post.findFirst({
      where: { id: postId, deletedAt: null },
      include: { category: { select: { name: true } } },
    });
    if (!post) return fail("帖子不存在或已删除");

    const text = buildEmbeddingText(post, post.category.name);
    const config = await getRagConfig();
    const result = await embedWithFallback([text], config.provider);

    const vector = result.vectors[0];
    if (!vector || vector.length === 0) return fail("向量服务未返回有效结果");

    await prisma.postEmbedding.upsert({
      where: { postId: post.id },
      update: { vector, model: result.model, dim: result.dim, text },
      create: { postId: post.id, vector, model: result.model, dim: result.dim, text },
    });

    if (options.recomputeFromScratch) {
      await clearStaleMatches(post.id);
    }

    const run = await runMatchingFor(post.id);

    await prisma.embeddingTask.update({
      where: { id: taskId },
      data: { status: "DONE", error: result.error ?? null, attempts: { increment: 1 } },
    });

    return {
      embedded: true,
      model: result.model,
      dim: result.dim,
      usedFallback: result.usedFallback,
      matches: run.created,
      error: result.error,
    };
  } catch (error) {
    return fail(error instanceof Error ? error.message : String(error));
  }
}

/**
 * worker 使用：批量处理待办任务。
 * 返回本次处理的任务数，便于 worker 决定是否继续立即轮询。
 */
export async function processPendingTasks(limit = 10): Promise<number> {
  const tasks = await prisma.embeddingTask.findMany({
    where: { status: "PENDING" },
    orderBy: { createdAt: "asc" },
    take: limit,
    select: { id: true, postId: true },
  });

  if (tasks.length === 0) return 0;

  // 说明：单实例部署下直接串行处理即可；多实例部署需要加行级锁或状态机防止重复处理。
  let processed = 0;
  for (const task of tasks) {
    const result = await processPostPipeline(task.postId);
    if (result.embedded) processed += 1;
  }
  return processed;
}
