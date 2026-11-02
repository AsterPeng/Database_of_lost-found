/**
 * RAG 配置：存在 app_configs 表里，可在管理后台调整而不用改代码（CLFP-USR-0025）。
 * 读取时与代码里的默认值合并，表里没有记录也能正常运行。
 */
import { prisma } from "../db";
import type { ProviderKind } from "./providers";

export type RagWeights = {
  vector: number;
  category: number;
  location: number;
  time: number;
  keyword: number;
};

export type RagConfig = {
  provider: ProviderKind;
  weights: RagWeights;
  /** 低于该置信度不生成匹配 */
  threshold: number;
  /** 每条帖子最多推荐的匹配数 */
  maxMatches: number;
  /** 时间窗（天）：只与发生时间相差在窗口内的帖子比较 */
  windowDays: number;
  /** 参与打分计算的候选上限 */
  candidateLimit: number;
};

export const RAG_CONFIG_KEY = "rag.config";
export const CATEGORY_BOOST_KEY = "rag.category_boost";

function envProvider(): ProviderKind {
  const value = process.env.RAG_PROVIDER;
  if (value === "openai" || value === "ollama") return value;
  return "mock";
}

export const DEFAULT_RAG_CONFIG: RagConfig = {
  provider: envProvider(),
  weights: { vector: 0.5, category: 0.15, location: 0.15, time: 0.1, keyword: 0.1 },
  threshold: 0.45,
  maxMatches: 5,
  windowDays: 30,
  candidateLimit: 300,
};

function mergeConfig(stored: unknown): RagConfig {
  if (!stored || typeof stored !== "object") return { ...DEFAULT_RAG_CONFIG };
  const value = stored as Partial<RagConfig>;

  return {
    provider: value.provider === "openai" || value.provider === "ollama" ? value.provider : DEFAULT_RAG_CONFIG.provider,
    weights: { ...DEFAULT_RAG_CONFIG.weights, ...(value.weights ?? {}) },
    threshold: typeof value.threshold === "number" ? value.threshold : DEFAULT_RAG_CONFIG.threshold,
    maxMatches:
      typeof value.maxMatches === "number" ? value.maxMatches : DEFAULT_RAG_CONFIG.maxMatches,
    windowDays: typeof value.windowDays === "number" ? value.windowDays : DEFAULT_RAG_CONFIG.windowDays,
    candidateLimit:
      typeof value.candidateLimit === "number" ? value.candidateLimit : DEFAULT_RAG_CONFIG.candidateLimit,
  };
}

export async function getRagConfig(): Promise<RagConfig> {
  const row = await prisma.appConfig.findUnique({ where: { key: RAG_CONFIG_KEY } });
  return mergeConfig(row?.value);
}

export async function saveRagConfig(patch: Partial<RagConfig>): Promise<RagConfig> {
  const current = await getRagConfig();
  const next: RagConfig = { ...current, ...patch, weights: { ...current.weights, ...(patch.weights ?? {}) } };

  await prisma.appConfig.upsert({
    where: { key: RAG_CONFIG_KEY },
    update: { value: next },
    create: { key: RAG_CONFIG_KEY, value: next },
  });

  return next;
}

/**
 * 类别权重系数（CLFP-USR-0010 的「根据反馈优化推荐」）：
 * 某类别的历史反馈越正面，该类别的匹配置信度越高；样本不足时保持 1。
 */
export async function getCategoryBoost(): Promise<Record<string, number>> {
  const row = await prisma.appConfig.findUnique({ where: { key: CATEGORY_BOOST_KEY } });
  if (!row?.value || typeof row.value !== "object") return {};
  return row.value as Record<string, number>;
}

export async function saveCategoryBoost(boost: Record<string, number>): Promise<void> {
  await prisma.appConfig.upsert({
    where: { key: CATEGORY_BOOST_KEY },
    update: { value: boost },
    create: { key: CATEGORY_BOOST_KEY, value: boost },
  });
}

/** 反馈样本量阈值：少于该数量不调整权重，避免个别反馈放大成偏差 */
export const BOOST_MIN_SAMPLES = 3;
export const BOOST_MIN = 0.5;
export const BOOST_MAX = 1.5;
