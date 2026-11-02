/** 帖子作者在详情页/列表页可用的操作按钮（服务端组件） */
import Link from "next/link";
import { closePostAction, deletePostAction, markResolvedAction } from "@/server/post-actions";

export function PostOwnerActions({
  postId,
  status,
  type,
}: {
  postId: string;
  status: "OPEN" | "RESOLVED" | "CLOSED";
  type: "LOST" | "FOUND";
}) {
  if (status !== "OPEN") {
    // CLFP-USR-0005：已完成或已关闭的信息仅可查看
    return <p className="text-xs text-slate-400">这条信息已经结束，只能查看，不能再编辑或删除。</p>;
  }

  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <Link
        href={`/posts/${postId}/edit`}
        className="rounded-lg border border-slate-300 px-3 py-1.5 text-slate-700 transition hover:bg-slate-50"
      >
        编辑
      </Link>

      <form action={markResolvedAction}>
        <input type="hidden" name="postId" value={postId} />
        <button
          type="submit"
          className="rounded-lg border border-emerald-300 px-3 py-1.5 text-emerald-700 transition hover:bg-emerald-50"
        >
          {type === "LOST" ? "标记已找回" : "标记已归还"}
        </button>
      </form>

      <form action={closePostAction}>
        <input type="hidden" name="postId" value={postId} />
        <button
          type="submit"
          className="rounded-lg border border-slate-300 px-3 py-1.5 text-slate-600 transition hover:bg-slate-50"
        >
          关闭信息
        </button>
      </form>

      <form action={deletePostAction}>
        <input type="hidden" name="postId" value={postId} />
        <button
          type="submit"
          className="rounded-lg border border-red-200 px-3 py-1.5 text-red-600 transition hover:bg-red-50"
        >
          删除
        </button>
      </form>
    </div>
  );
}
