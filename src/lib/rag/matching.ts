/**
 * 语义匹配（CLFP-USR-0008）：把一条帖子与「类型互补」的历史帖子配对，算出置信度。
 *
 * 流程：
 * 1. 结构化预过滤：只比较类型互补、状态正常、作者不同、发生时间在时间窗内的帖子；
 * 2. 逐条打分：向量相似度 + 类别 + 地点 + 时间 + 关键词重合，权重来自配置；
 * 3. 按置信度排序，超过阈值且在前若干名的配对写入 matches 表（双向可见）。
 *
 * 关于降级：未配置真实向量模型时，向量来自本地特征哈希，其余维度照常计算，
 * 因此即使没有 API Key，整个匹配链路也能完整跑通与演示。
 */
import { PRESET_LOCATIONS } from "../constants";
import { prisma } from "../db";
import {
  BOOST_MAX,
  BOOST_MIN,
  BOOST_MIN_SAMPLES,
  getCategoryBoost,
  getRagConfig,
  saveCategoryBoost,
  type RagConfig,
  type RagWeights,
} from "./config";
import { charBigrams, clamp, cosineSimilarity, jaccard } from "./lexical";
import { notify } from "../notifications";
import { resolveChatProvider } from "./providers";
import type { ChatMessage } from "./types";

/** 参与向量化的文本：标题 + 类别 + 地点 + 描述 */
export function buildEmbeddingText(
  post: { title: string; description: string; location: string },
  categoryName: string,
): string {
  return [post.title, categoryName, post.location, post.description].filter(Boolean).join(" ");
}

export type ScoreDetail = {
  vector: number;
  category: number;
  location: number;
  time: number;
  keyword: number;
  weights: RagWeights;
  boost: number;
  base: number;
  confidence: number;
  reason?: string;
};

type ScorablePost = {
  title: string;
  description: string;
  location: string;
  categoryId: string;
  occurredAt: Date;
  vector: number[];
  /** 用于匹配成功后给对方发通知 */
  authorId: string;
};

/** 地点相似度：优先按预设地点归类比较，其次退化为字符串包含关系 */
export function locationSimilarity(a: string, b: string): number {
  const presetOf = (value: string) =>
    PRESET_LOCATIONS.find((item) => item !== "其它" && value.includes(item));

  const presetA = presetOf(a);
  const presetB = presetOf(b);
  if (presetA && presetB) return presetA === presetB ? 1 : 0;

  if (a && b && (a.includes(b) || b.includes(a))) return 0.8;
  return 0;
}

/** 计算一对帖子的置信度 */
export function scorePair(
  source: ScorablePost,
  candidate: ScorablePost,
  config: RagConfig,
  boost: number,
): ScoreDetail {
  const vector = clamp(cosineSimilarity(source.vector, candidate.vector));
  // 类别相同得满分，不同也保留少量基础分（有些物品会被归到不同类别）
  const category = source.categoryId === candidate.categoryId ? 1 : 0.3;
  const location = locationSimilarity(source.location, candidate.location);

  const windowMs = config.windowDays * 24 * 60 * 60 * 1000;
  const diffMs = Math.abs(source.occurredAt.getTime() - candidate.occurredAt.getTime());
  const time = clamp(1 - diffMs / windowMs);

  const keyword = jaccard(
    charBigrams(`${source.title}${source.description}`),
    charBigrams(`${candidate.title}${candidate.description}`),
  );

  const weights = config.weights;
  const totalWeight =
    weights.vector + weights.category + weights.location + weights.time + weights.keyword || 1;

  const base =
    (weights.vector * vector +
      weights.category * category +
      weights.location * location +
      weights.time * time +
      weights.keyword * keyword) /
    totalWeight;

  // 类别权重系数来自历史反馈（CLFP-USR-0010）
  const confidence = clamp(base * boost);

  return {
    vector: Number(vector.toFixed(4)),
    category,
    location: Number(location.toFixed(4)),
    time: Number(time.toFixed(4)),
    keyword: Number(keyword.toFixed(4)),
    weights,
    boost,
    base: Number(base.toFixed(4)),
    confidence: Number(confidence.toFixed(4)),
  };
}

/** 规则生成的推荐理由：模型不可用时也能给出可解释的说明 */
export function buildRuleReason(source: ScorablePost, candidate: ScorablePost, detail: ScoreDetail): string {
  const parts: string[] = [];

  if (detail.category >= 1) parts.push("物品类别一致");
  if (detail.location >= 1) parts.push(`地点相同（${source.location}）`);
  else if (detail.location >= 0.8) parts.push("地点接近");
  if (detail.time >= 0.7) parts.push("发生时间接近");
  if (detail.vector >= 0.5) parts.push("物品描述相似度较高");
  if (detail.keyword >= 0.3) parts.push("名称与特征有较多重合");

  if (parts.length === 0) parts.push("综合相似度达到推荐阈值");
  return `${parts.join("，")}。`;
}

/**
 * 可选的模型生成理由（CLFP-USR-0020 中提到模型用于补充说明）。
 * 严格约束模型只能基于给定的两条帖子写一句话，不允许引入新信息；
 * 失败或超时一律回退到规则文案。
 */
export async function explainWithModel(
  source: ScorablePost,
  candidate: ScorablePost,
  providerKind: RagConfig["provider"],
  fallback: string,
): Promise<string> {
  const provider = resolveChatProvider(providerKind);
  if (!provider) return fallback;

  const messages: ChatMessage[] = [
    {
      role: "system",
      content:
        "你是校园失物招领平台的匹配说明生成器。只能依据用户给出的两条信息写一句不超过 40 字的中文说明，说明为什么它们可能是同一件物品。禁止编造任何未提供的信息，禁止输出 JSON 或多余解释。",
    },
    {
      role: "user",
      content: `失物信息：${source.title}｜${source.location}｜${source.description}\n拾物信息：${candidate.title}｜${candidate.location}｜${candidate.description}`,
    },
  ];

  try {
    const text = await provider.complete(messages, { timeoutMs: 3000, maxTokens: 120 });
    return text ? text.slice(0, 120) : fallback;
  } catch {
    return fallback;
  }
}

export type MatchRunResult = {
  created: number;
  candidates: number;
  aboveThreshold: number;
  threshold: number;
  boost: number;
};

/**
 * 为一条帖子计算匹配并写入数据库。
 * 只与「类型互补」的帖子配对，且同一条配对只保留一行（唯一约束保证）。
 */
export async function runMatchingFor(postId: string): Promise<MatchRunResult> {
  const post = await prisma.post.findFirst({
    where: { id: postId, deletedAt: null, takenDownAt: null, archivedAt: null, status: "OPEN" },
    include: { category: true, embedding: true },
  });

  const empty: MatchRunResult = { created: 0, candidates: 0, aboveThreshold: 0, threshold: 0, boost: 1 };
  if (!post?.embedding) return empty;

  const config = await getRagConfig();
  const boostMap = await getCategoryBoost();
  const boost = boostMap[post.categoryId] ?? 1;
  const windowMs = config.windowDays * 24 * 60 * 60 * 1000;

  const candidates = await prisma.post.findMany({
    where: {
      id: { not: post.id },
      deletedAt: null,
      takenDownAt: null,
      archivedAt: null,
      status: "OPEN",
      type: post.type === "LOST" ? "FOUND" : "LOST",
      authorId: { not: post.authorId },
      occurredAt: {
        gte: new Date(post.occurredAt.getTime() - windowMs),
        lte: new Date(post.occurredAt.getTime() + windowMs),
      },
    },
    include: { category: true, embedding: true },
    orderBy: { createdAt: "desc" },
    take: config.candidateLimit,
  });

  if (candidates.length === 0) return { ...empty, threshold: config.threshold, boost };

  // 已经反馈过的配对不再重复推荐（尤其是「不是我的」）
  const existing = await prisma.match.findMany({
    where: { OR: [{ lostPostId: post.id }, { foundPostId: post.id }] },
    select: { lostPostId: true, foundPostId: true, feedback: true },
  });
  const settled = new Set(
    existing
      .filter((item) => item.feedback === "NOT_MINE" || item.feedback === "MINE")
      .map((item) => `${item.lostPostId}:${item.foundPostId}`),
  );

  const source: ScorablePost = {
    title: post.title,
    description: post.description,
    location: post.location,
    categoryId: post.categoryId,
    occurredAt: post.occurredAt,
    vector: post.embedding.vector,
    authorId: post.authorId,
  };

  const scored: { lostId: string; foundId: string; candidate: ScorablePost; detail: ScoreDetail }[] = [];

  for (const item of candidates) {
    if (!item.embedding) continue;

    const lostId = post.type === "LOST" ? post.id : item.id;
    const foundId = post.type === "LOST" ? item.id : post.id;
    if (settled.has(`${lostId}:${foundId}`)) continue;

    const candidate: ScorablePost = {
      title: item.title,
      description: item.description,
      location: item.location,
      categoryId: item.categoryId,
      occurredAt: item.occurredAt,
      vector: item.embedding.vector,
      authorId: item.authorId,
    };

    const detail = scorePair(source, candidate, config, boost);
    if (detail.confidence < config.threshold) continue;
    scored.push({ lostId, foundId, candidate, detail });
  }

  scored.sort((a, b) => b.detail.confidence - a.detail.confidence);
  const top = scored.slice(0, config.maxMatches);

  let created = 0;
  for (const [index, item] of top.entries()) {
    const ruleReason = buildRuleReason(source, item.candidate, item.detail);
    // 只有配置了真实对话模型时才调用模型补充说明，且仅对前三条生成，控制延迟
    const reason =
      index < 3
        ? await explainWithModel(source, item.candidate, config.provider, ruleReason)
        : ruleReason;

    const detail = { ...item.detail, reason };
    await prisma.match.upsert({
      where: { lostPostId_foundPostId: { lostPostId: item.lostId, foundPostId: item.foundId } },
      update: { score: item.detail.confidence, detail },
      create: {
        lostPostId: item.lostId,
        foundPostId: item.foundId,
        score: item.detail.confidence,
        detail,
      },
    });
    created += 1;
  }

  // 新匹配产生时通知双方（CLFP-USR-0013 的「新的匹配推荐」提醒）
  if (created > 0 && top.length > 0) {
    const percent = (value: number) => `${Math.round(value * 100)}%`;

    await notify({
      userId: post.authorId,
      type: "MATCH",
      title: "找到可能匹配的信息",
      body: `你的《${post.title}》匹配到 ${created} 条可能相关的信息，最高置信度 ${percent(top[0].detail.confidence)}。`,
      link: "/me/matches",
    });

    for (const item of top) {
      if (item.candidate.authorId === post.authorId) continue;
      await notify({
        userId: item.candidate.authorId,
        type: "MATCH",
        title: "你的信息有了新的匹配",
        body: `《${item.candidate.title}》与一条新发布的《${post.title}》匹配置信度 ${percent(item.detail.confidence)}，可以去看一看。`,
        link: "/me/matches",
      });
    }
  }

  return {
    created,
    candidates: candidates.length,
    aboveThreshold: scored.length,
    threshold: config.threshold,
    boost,
  };
}

/** 帖子内容变化后清理未反馈的旧匹配，避免推荐结果过期 */
export async function clearStaleMatches(postId: string): Promise<number> {
  const result = await prisma.match.deleteMany({
    where: {
      feedback: "NONE",
      OR: [{ lostPostId: postId }, { foundPostId: postId }],
    },
  });
  return result.count;
}

/**
 * 反馈驱动的权重自适应（CLFP-USR-0010）：
 * 按失物帖的类别统计「是我的 / 不是我的」，正反馈比例高的类别整体提权。
 * 样本少于 BOOST_MIN_SAMPLES 时不调整，避免被个别反馈带偏。
 */
export async function recomputeCategoryBoost(): Promise<Record<string, number>> {
  const rows = await prisma.match.findMany({
    where: { feedback: { in: ["MINE", "NOT_MINE"] } },
    select: { feedback: true, lostPost: { select: { categoryId: true } } },
  });

  const stats = new Map<string, { positive: number; total: number }>();
  for (const row of rows) {
    const key = row.lostPost.categoryId;
    const entry = stats.get(key) ?? { positive: 0, total: 0 };
    entry.total += 1;
    if (row.feedback === "MINE") entry.positive += 1;
    stats.set(key, entry);
  }

  const boost: Record<string, number> = {};
  for (const [categoryId, { positive, total }] of stats) {
    if (total < BOOST_MIN_SAMPLES) continue;
    const positiveRate = positive / total;
    boost[categoryId] = Number(
      clamp(1 + 0.6 * (positiveRate - 0.5) * 2, BOOST_MIN, BOOST_MAX).toFixed(3),
    );
  }

  await saveCategoryBoost(boost);
  return boost;
}
