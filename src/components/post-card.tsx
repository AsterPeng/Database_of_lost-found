/** 帖子卡片，列表页与个人中心共用 */
import Link from "next/link";
import { POST_STATUS_LABEL, POST_STATUS_STYLE, POST_TYPE_LABEL } from "@/lib/constants";

export type PostCardData = {
  id: string;
  type: "LOST" | "FOUND";
  title: string;
  status: "OPEN" | "RESOLVED" | "CLOSED";
  location: string;
  occurredAt: Date;
  categoryName: string;
  coverImageId: string | null;
};

const dateFormatter = new Intl.DateTimeFormat("zh-CN", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

function categoryIllustration(name: string) {
  if (name.includes("卡") || name.includes("证")) return "🪪";
  if (name.includes("电子")) return "📱";
  if (name.includes("钥匙")) return "🔑";
  if (name.includes("书")) return "📚";
  if (name.includes("服")) return "🧥";
  return "🎒";
}

export function PostCard({ post }: { post: PostCardData }) {
  return (
    <Link
      href={`/posts/${post.id}`}
      className={`surface-hover group flex min-h-28 gap-3 rounded-lg border-2 bg-[#fffdf8] p-3.5 shadow-[3px_4px_0_rgba(137,112,82,0.1)] ${post.type === "LOST" ? "border-[#e4b3a0]" : "border-[#a8cfc2]"}`}
    >
      <div className={`h-20 w-20 shrink-0 overflow-hidden rounded-md border border-[#d9c8a9] ${post.type === "LOST" ? "bg-[#ffe6d7]" : "bg-[#dceee7]"}`}>
        {post.coverImageId ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={`/api/images/${post.coverImageId}`}
            alt={post.title}
            className="h-full w-full object-cover transition duration-500 group-hover:scale-105"
          />
        ) : (
          <div className="grid h-full w-full place-items-center text-3xl transition duration-300 group-hover:rotate-[-7deg] group-hover:scale-110" aria-label="暂无物品照片">
            {categoryIllustration(post.categoryName)}
          </div>
        )}
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span
            className={`rounded px-2 py-1 text-[11px] font-bold ${
              post.type === "LOST" ? "bg-[#ffdfc7] text-[#9d4438]" : "bg-[#cfebe1] text-[#216a62]"
            }`}
          >
            {POST_TYPE_LABEL[post.type]}
          </span>
          <span className={`rounded px-2 py-1 text-[11px] ${POST_STATUS_STYLE[post.status]}`}>
            {POST_STATUS_LABEL[post.status]}
          </span>
        </div>

        <p className="mt-2 truncate text-sm font-bold text-slate-900 transition group-hover:text-sky-700">{post.title}</p>
        <p className="mt-0.5 truncate text-xs text-slate-500">
          {post.categoryName} · {post.location} · {dateFormatter.format(post.occurredAt)}
        </p>
      </div>
    </Link>
  );
}
