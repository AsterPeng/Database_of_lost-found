import type { Metadata } from "next";
import Link from "next/link";
import { MatchCard, type MatchCardData, type MatchDetail } from "@/components/match-card";
import { prisma } from "@/lib/db";
import { getCategoryBoost, getRagConfig } from "@/lib/rag/config";
import { requireUser } from "@/lib/session";

export const metadata: Metadata = { title: "我的匹配 · 校园失物招领平台" };

const postInclude = {
  category: { select: { name: true } },
  images: { orderBy: { sortOrder: "asc" }, take: 1, select: { id: true } },
  author: { select: { nickname: true } },
} as const;

/** 「我的匹配」（CLFP-USR-0009）：展示与本人相关的全部匹配推荐并支持反馈 */
export default async function MyMatchesPage() {
  const user = await requireUser();

  const [matches, config, boost] = await Promise.all([
    prisma.match.findMany({
      where: {
        AND: [
          { feedback: { not: "NOT_MINE" } },
          { lostPost: { deletedAt: null, takenDownAt: null, status: "OPEN" } },
          { foundPost: { deletedAt: null, takenDownAt: null, status: "OPEN" } },
          {
            OR: [
              { lostPost: { authorId: user.id } },
              { foundPost: { authorId: user.id } },
            ],
          },
        ],
      },
      orderBy: [{ score: "desc" }, { createdAt: "desc" }],
      take: 50,
      include: {
        lostPost: { include: postInclude },
        foundPost: { include: postInclude },
      },
    }),
    getRagConfig(),
    getCategoryBoost(),
  ]);

  const items: MatchCardData[] = matches.map((match) => {
    const iAmLostSide = match.lostPost.authorId === user.id;
    const mine = iAmLostSide ? match.lostPost : match.foundPost;
    const other = iAmLostSide ? match.foundPost : match.lostPost;

    return {
      id: match.id,
      score: match.score,
      detail: (match.detail ?? {}) as MatchDetail,
      feedback: match.feedback,
      createdAt: match.createdAt,
      mine: { id: mine.id, title: mine.title, type: mine.type },
      other: {
        id: other.id,
        title: other.title,
        type: other.type,
        location: other.location,
        occurredAt: other.occurredAt,
        categoryName: other.category.name,
        coverImageId: other.images[0]?.id ?? null,
        authorNickname: other.author.nickname,
      },
    };
  });

  const pending = items.filter((item) => item.feedback === "NONE");
  const confirmed = items.filter((item) => item.feedback === "MINE");

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">我的匹配</h1>
          <p className="mt-1 text-sm text-slate-500">
            系统把你的信息与类型互补的历史信息做了语义匹配，按置信度从高到低排列。
          </p>
        </div>
        <Link
          href="/posts/new"
          className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50"
        >
          发布新信息
        </Link>
      </div>

      <div className="grid grid-cols-3 gap-3">
        {[
          { label: "全部匹配", value: items.length },
          { label: "待反馈", value: pending.length },
          { label: "已确认是我的", value: confirmed.length },
        ].map((item) => (
          <div key={item.label} className="rounded-xl border border-slate-200 bg-white p-4">
            <p className="text-xs text-slate-500">{item.label}</p>
            <p className="mt-1 text-2xl font-semibold text-slate-900">{item.value}</p>
          </div>
        ))}
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-4 text-xs text-slate-500">
        <p>
          当前匹配阈值 {config.threshold}、时间窗 {config.windowDays} 天、每条最多推荐{" "}
          {config.maxMatches} 条；向量模型：
          <span className="font-medium text-slate-700">
            {config.provider === "mock" ? "本地降级模式（未配置真实向量模型）" : config.provider}
          </span>
        </p>
        {Object.keys(boost).length > 0 ? (
          <p className="mt-1">
            已根据反馈自动调整部分类别的权重系数（共 {Object.keys(boost).length} 个类别），
            正反馈越多的类别越容易被推荐。
          </p>
        ) : (
          <p className="mt-1">反馈样本达到 3 条后，系统会开始自动调整类别权重。</p>
        )}
      </div>

      {items.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center">
          <p className="text-sm text-slate-600">暂时没有匹配到相关信息。</p>
          <p className="mt-1 text-xs text-slate-500">
            发布寻物启事或拾物信息后，系统会自动检索并在这里给出推荐。
          </p>
        </div>
      ) : (
        <ul className="space-y-4">
          {items.map((item) => (
            <li key={item.id}>
              <MatchCard match={item} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
