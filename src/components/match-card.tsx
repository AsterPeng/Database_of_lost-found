/** 一条匹配推荐卡片（服务端组件）：展示对方信息、置信度、推荐理由与反馈按钮 */
import Link from "next/link";
import { POST_TYPE_LABEL } from "@/lib/constants";
import { formatDateTime, formatRelative } from "@/lib/datetime";
import { submitMatchFeedbackAction } from "@/server/match-actions";

export type MatchDetail = {
  vector?: number;
  category?: number;
  location?: number;
  time?: number;
  keyword?: number;
  weights?: Record<string, number>;
  boost?: number;
  base?: number;
  confidence?: number;
  reason?: string;
};

export type MatchCardData = {
  id: string;
  score: number;
  detail: MatchDetail;
  feedback: "NONE" | "MINE" | "NOT_MINE" | "UNSURE";
  createdAt: Date;
  mine: {
    id: string;
    title: string;
    type: "LOST" | "FOUND";
  };
  other: {
    id: string;
    title: string;
    type: "LOST" | "FOUND";
    location: string;
    occurredAt: Date;
    categoryName: string;
    coverImageId: string | null;
    authorNickname: string;
  };
};

const FEEDBACK_LABEL: Record<MatchCardData["feedback"], string> = {
  NONE: "未反馈",
  MINE: "是我的物品",
  NOT_MINE: "不是我的物品",
  UNSURE: "待核实",
};

function FeedbackButton({
  matchId,
  value,
  active,
  children,
  tone,
}: {
  matchId: string;
  value: string;
  active: boolean;
  children: React.ReactNode;
  tone: "green" | "red" | "slate";
}) {
  const tones = {
    green: active
      ? "border-emerald-500 bg-emerald-50 text-emerald-700"
      : "border-slate-200 text-slate-600 hover:border-emerald-300 hover:text-emerald-700",
    red: active
      ? "border-red-400 bg-red-50 text-red-600"
      : "border-slate-200 text-slate-600 hover:border-red-300 hover:text-red-600",
    slate: active
      ? "border-sky-500 bg-sky-50 text-sky-700"
      : "border-slate-200 text-slate-600 hover:border-sky-300 hover:text-sky-700",
  } as const;

  return (
    <form action={submitMatchFeedbackAction}>
      <input type="hidden" name="matchId" value={matchId} />
      <input type="hidden" name="feedback" value={value} />
      <button
        type="submit"
        className={`rounded-lg border px-2.5 py-1 text-xs transition ${tones[tone]}`}
      >
        {children}
      </button>
    </form>
  );
}

export function MatchCard({ match }: { match: MatchCardData }) {
  const confidence = Math.round(match.score * 100);
  const detail = match.detail;

  return (
    <article className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs text-slate-500">
            你的{POST_TYPE_LABEL[match.mine.type]} ·{" "}
            <Link href={`/posts/${match.mine.id}`} className="text-slate-600 hover:text-sky-700">
              {match.mine.title}
            </Link>
          </p>
          <p className="mt-1 text-xs text-slate-400">
            推荐于 {formatRelative(match.createdAt)}
            {match.feedback !== "NONE" ? ` · 已反馈：${FEEDBACK_LABEL[match.feedback]}` : ""}
          </p>
        </div>

        <div className="shrink-0 text-right">
          <p className="text-xs text-slate-500">置信度</p>
          <p
            className={`text-lg font-semibold ${
              confidence >= 70 ? "text-emerald-600" : confidence >= 50 ? "text-sky-600" : "text-slate-500"
            }`}
          >
            {confidence}%
          </p>
        </div>
      </div>

      <Link
        href={`/posts/${match.other.id}`}
        className="flex gap-3 rounded-lg border border-slate-200 p-3 transition hover:border-sky-300"
      >
        <div className="h-16 w-16 shrink-0 overflow-hidden rounded-lg bg-slate-100">
          {match.other.coverImageId ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={`/api/images/${match.other.coverImageId}`}
              alt={match.other.title}
              className="h-full w-full object-cover"
            />
          ) : (
            <div className="grid h-full w-full place-items-center text-xs text-slate-400">无图</div>
          )}
        </div>
        <div className="min-w-0">
          <p className="flex items-center gap-2">
            <span
              className={`rounded px-1.5 py-0.5 text-xs ${
                match.other.type === "LOST"
                  ? "bg-amber-50 text-amber-700"
                  : "bg-teal-50 text-teal-700"
              }`}
            >
              {POST_TYPE_LABEL[match.other.type]}
            </span>
            <span className="truncate text-sm font-medium text-slate-900">{match.other.title}</span>
          </p>
          <p className="mt-1 truncate text-xs text-slate-500">
            {match.other.categoryName} · {match.other.location} · {formatDateTime(match.other.occurredAt)}
          </p>
          <p className="mt-0.5 text-xs text-slate-400">发布者 {match.other.authorNickname}</p>
        </div>
      </Link>

      {detail.reason ? (
        <p className="rounded-lg bg-sky-50 px-3 py-2 text-xs leading-5 text-sky-800">
          推荐理由：{detail.reason}
        </p>
      ) : null}

      <details className="text-xs text-slate-500">
        <summary className="cursor-pointer select-none hover:text-slate-700">
          查看打分明细（为什么是 {confidence}%）
        </summary>
        <ul className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-3">
          <li>向量相似度：{detail.vector ?? "-"}</li>
          <li>类别匹配：{detail.category ?? "-"}</li>
          <li>地点匹配：{detail.location ?? "-"}</li>
          <li>时间接近度：{detail.time ?? "-"}</li>
          <li>关键词重合：{detail.keyword ?? "-"}</li>
          <li>类别权重系数：{detail.boost ?? 1}</li>
        </ul>
        <p className="mt-2">
          加权方式：向量 {detail.weights?.vector ?? 0.5}、类别 {detail.weights?.category ?? 0.15}、
          地点 {detail.weights?.location ?? 0.15}、时间 {detail.weights?.time ?? 0.1}、
          关键词 {detail.weights?.keyword ?? 0.1}，再乘以类别权重系数后归一化。
        </p>
      </details>

      <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3">
        <FeedbackButton matchId={match.id} value="MINE" active={match.feedback === "MINE"} tone="green">
          是我的物品
        </FeedbackButton>
        <FeedbackButton
          matchId={match.id}
          value="NOT_MINE"
          active={match.feedback === "NOT_MINE"}
          tone="red"
        >
          不是我的物品
        </FeedbackButton>
        <FeedbackButton
          matchId={match.id}
          value="UNSURE"
          active={match.feedback === "UNSURE"}
          tone="slate"
        >
          待核实
        </FeedbackButton>
        <span className="text-xs text-slate-400">
          反馈会影响推荐权重；选「不是我的」后不再推荐这条配对
        </span>
      </div>
    </article>
  );
}
