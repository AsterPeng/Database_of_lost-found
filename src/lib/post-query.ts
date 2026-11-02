/**
 * 帖子查询：信息流筛选（CLFP-USR-0006）与关键词搜索（CLFP-USR-0007）。
 *
 * 关键词搜索策略：
 * 1. 把查询串按空白拆成关键词，要求每个关键词至少命中标题/描述/地点之一（AND 逻辑）；
 * 2. 命中判断用 ILIKE '%词%'，配合 pg_trgm 的 GIN 索引（见 migrations 里的 trgm_search）；
 * 3. 相关度排序在应用层完成，权重规则集中在 scorePost()，便于解释与调整。
 */
import type { Prisma } from "@prisma/client";
import { prisma } from "./db";
import type { PostCardData } from "@/components/post-card";

export const PAGE_SIZE = 12;
/** 关键词搜索最多参与排序的候选数，避免极端查询拖慢响应 */
const SEARCH_CANDIDATE_LIMIT = 300;
/** 单个关键词最大长度与关键词数量上限 */
const MAX_KEYWORD_LENGTH = 20;
const MAX_KEYWORDS = 5;

export const TIME_RANGES = [
  { key: "all", label: "全部时间", days: null },
  { key: "1d", label: "近 24 小时", days: 1 },
  { key: "7d", label: "近 7 天", days: 7 },
  { key: "30d", label: "近 30 天", days: 30 },
  { key: "180d", label: "近半年", days: 180 },
] as const;

export const STATUS_OPTIONS = [
  { key: "OPEN", label: "寻找中" },
  { key: "RESOLVED", label: "已解决" },
  { key: "ALL", label: "全部状态" },
] as const;

export const TYPE_OPTIONS = [
  { key: "ALL", label: "全部" },
  { key: "LOST", label: "寻物启事" },
  { key: "FOUND", label: "拾物信息" },
] as const;

export type ListFilters = {
  type: "ALL" | "LOST" | "FOUND";
  categoryId?: string;
  location?: string;
  range: string;
  status: "OPEN" | "RESOLVED" | "ALL";
  q?: string;
  page: number;
};

/** 从 URL 查询参数解析筛选条件，非法值一律回退到默认值 */
export function parseFilters(params: Record<string, string | string[] | undefined>): ListFilters {
  const pick = (key: string): string | undefined => {
    const value = params[key];
    const single = Array.isArray(value) ? value[0] : value;
    const trimmed = single?.trim();
    return trimmed ? trimmed : undefined;
  };

  const typeParam = pick("type");
  const statusParam = pick("status");
  const rangeParam = pick("range");
  const pageParam = Number(pick("page") ?? "1");

  return {
    type: typeParam === "LOST" || typeParam === "FOUND" ? typeParam : "ALL",
    categoryId: pick("categoryId"),
    location: pick("location"),
    range: TIME_RANGES.some((r) => r.key === rangeParam) ? rangeParam! : "all",
    status:
      statusParam === "RESOLVED" || statusParam === "ALL"
        ? (statusParam as "RESOLVED" | "ALL")
        : "OPEN",
    q: pick("q"),
    page: Number.isFinite(pageParam) && pageParam > 0 ? Math.floor(pageParam) : 1,
  };
}

/** 把筛选条件还原成 URL 查询参数（省略默认值，保持链接干净） */
export function filtersToQuery(filters: ListFilters): Record<string, string | undefined> {
  return {
    type: filters.type === "ALL" ? undefined : filters.type,
    categoryId: filters.categoryId,
    location: filters.location,
    range: filters.range === "all" ? undefined : filters.range,
    status: filters.status === "OPEN" ? undefined : filters.status,
    q: filters.q,
  };
}

/** 把筛选条件转成 Prisma 查询条件 */
export function buildWhere(filters: ListFilters): Prisma.PostWhereInput {
  // 被管理员下架、或被归档的信息不进入公开列表（CLFP-USR-0016、0021）
  const where: Prisma.PostWhereInput = { deletedAt: null, takenDownAt: null, archivedAt: null };

  if (filters.type !== "ALL") where.type = filters.type;
  if (filters.categoryId) where.categoryId = filters.categoryId;
  if (filters.location) {
    where.location = { contains: filters.location, mode: "insensitive" };
  }
  if (filters.status !== "ALL") where.status = filters.status;

  const range = TIME_RANGES.find((item) => item.key === filters.range);
  if (range?.days) {
    where.occurredAt = { gte: new Date(Date.now() - range.days * 24 * 60 * 60 * 1000) };
  }

  return where;
}

const listInclude = {
  category: { select: { name: true } },
  images: { orderBy: { sortOrder: "asc" }, take: 1, select: { id: true } },
} satisfies Prisma.PostInclude;

type PostWithRelations = Prisma.PostGetPayload<{ include: typeof listInclude }>;

function toCardData(post: PostWithRelations): PostCardData {
  return {
    id: post.id,
    type: post.type,
    title: post.title,
    status: post.status,
    location: post.location,
    occurredAt: post.occurredAt,
    categoryName: post.category.name,
    coverImageId: post.images[0]?.id ?? null,
  };
}

/** 信息流列表（CLFP-USR-0006） */
export async function listPosts(
  filters: ListFilters,
): Promise<{ items: PostCardData[]; total: number; page: number; totalPages: number }> {
  const where = buildWhere(filters);
  const total = await prisma.post.count({ where });
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const page = Math.min(filters.page, totalPages);

  const posts = await prisma.post.findMany({
    where,
    orderBy: { createdAt: "desc" },
    skip: (page - 1) * PAGE_SIZE,
    take: PAGE_SIZE,
    include: listInclude,
  });

  return { items: posts.map(toCardData), total, page, totalPages };
}

/** 首页使用：按类型取最新几条（CLFP-USR-0006 的信息流入口） */
export async function latestPosts(type: "LOST" | "FOUND", take = 6): Promise<PostCardData[]> {
  const posts = await prisma.post.findMany({
    where: { deletedAt: null, takenDownAt: null, archivedAt: null, status: "OPEN", type },
    orderBy: { createdAt: "desc" },
    take,
    include: listInclude,
  });
  return posts.map(toCardData);
}

/** 把查询串拆成关键词 */
export function tokenize(query: string): string[] {
  return query
    .split(/[\s,，、]+/)
    .map((token) => token.trim().slice(0, MAX_KEYWORD_LENGTH))
    .filter((token) => token.length > 0)
    .slice(0, MAX_KEYWORDS);
}

export type SearchHit = PostCardData & { score: number; matchedIn: string[] };

/**
 * 相关度打分（权重可调，集中在这里便于解释）：
 * - 标题命中权重最高，地点次之，描述再次；
 * - 完整查询串整体命中额外加分；
 * - 越新的帖子略微加分，避免旧帖长期占据榜首。
 */
export function scorePost(
  post: { title: string; description: string; location: string; occurredAt: Date },
  tokens: string[],
  rawQuery: string,
): { score: number; matchedIn: string[] } {
  const title = post.title.toLowerCase();
  const description = post.description.toLowerCase();
  const location = post.location.toLowerCase();
  const matchedIn = new Set<string>();
  let score = 0;

  const full = rawQuery.trim().toLowerCase();
  if (full.length > 1) {
    if (title.includes(full)) {
      score += 6;
      matchedIn.add("标题");
    }
    if (location.includes(full)) {
      score += 3;
      matchedIn.add("地点");
    }
    if (description.includes(full)) {
      score += 2;
      matchedIn.add("描述");
    }
  }

  for (const token of tokens) {
    const key = token.toLowerCase();
    if (title.includes(key)) {
      score += 3;
      matchedIn.add("标题");
    }
    if (location.includes(key)) {
      score += 2;
      matchedIn.add("地点");
    }
    if (description.includes(key)) {
      score += 1;
      matchedIn.add("描述");
    }
  }

  const ageInDays = (Date.now() - post.occurredAt.getTime()) / (24 * 60 * 60 * 1000);
  score += Math.max(0, 1.5 - ageInDays / 60);

  return { score: Number(score.toFixed(3)), matchedIn: [...matchedIn] };
}

/**
 * 关键词搜索（CLFP-USR-0007）。
 * 先用数据库做候选收敛，再按相关度排序；返回结果按类型分组展示。
 */
export async function searchPosts(
  query: string,
  filters: ListFilters,
): Promise<{ hits: SearchHit[]; total: number; page: number; totalPages: number; tokens: string[] }> {
  const tokens = tokenize(query);
  const empty = { hits: [], total: 0, page: 1, totalPages: 1, tokens };
  if (tokens.length === 0) return empty;

  const base = buildWhere({ ...filters, q: undefined });

  const where: Prisma.PostWhereInput = {
    ...base,
    AND: tokens.map((token) => ({
      OR: [
        { title: { contains: token, mode: "insensitive" as const } },
        { description: { contains: token, mode: "insensitive" as const } },
        { location: { contains: token, mode: "insensitive" as const } },
      ],
    })),
  };

  const candidates = await prisma.post.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: SEARCH_CANDIDATE_LIMIT,
    include: listInclude,
  });

  const ranked: SearchHit[] = candidates
    .map((post) => {
      const { score, matchedIn } = scorePost(post, tokens, query);
      return { ...toCardData(post), score, matchedIn };
    })
    .sort((a, b) => b.score - a.score || b.occurredAt.getTime() - a.occurredAt.getTime());

  const totalPages = Math.max(1, Math.ceil(ranked.length / PAGE_SIZE));
  const page = Math.min(filters.page, totalPages);
  const hits = ranked.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  return { hits, total: ranked.length, page, totalPages, tokens };
}
