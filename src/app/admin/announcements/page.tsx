import type { Metadata } from "next";
import { AnnouncementForm } from "@/components/announcement-form";
import { Card } from "@/components/ui";
import { listAllAnnouncements } from "@/lib/announcements";
import { formatDateTime } from "@/lib/datetime";
import {
  deleteAnnouncementAction,
  toggleAnnouncementPinnedAction,
} from "@/server/announcement-actions";

export const metadata: Metadata = { title: "公告管理 · 校园失物招领平台" };

/** 公告管理（CLFP-USR-0024） */
export default async function AdminAnnouncementsPage() {
  const announcements = await listAllAnnouncements();
  const now = new Date();

  return (
    <div className="space-y-6">
      <Card title="发布公告" description="公告会展示在首页顶部，置顶公告排在最前">
        <AnnouncementForm />
      </Card>

      <Card title="已有公告">
        {announcements.length === 0 ? (
          <p className="text-sm text-slate-500">还没有发布过公告。</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {announcements.map((item) => {
              const expired = item.expiresAt ? item.expiresAt.getTime() <= now.getTime() : false;
              return (
                <li key={item.id} className="space-y-2 py-4">
                  <div className="flex flex-wrap items-center gap-2">
                    {item.pinned ? (
                      <span className="rounded bg-amber-50 px-2 py-0.5 text-xs text-amber-700">
                        置顶
                      </span>
                    ) : null}
                    {expired ? (
                      <span className="rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-500">
                        已过期
                      </span>
                    ) : (
                      <span className="rounded bg-emerald-50 px-2 py-0.5 text-xs text-emerald-700">
                        生效中
                      </span>
                    )}
                    <span className="text-sm font-medium text-slate-900">{item.title}</span>
                  </div>

                  <p className="whitespace-pre-wrap text-sm text-slate-600">{item.body}</p>

                  <p className="text-xs text-slate-400">
                    发布人 {item.createdBy?.nickname ?? "已注销"} · {formatDateTime(item.publishedAt)}
                    {item.expiresAt ? ` · 过期时间 ${formatDateTime(item.expiresAt)}` : ""}
                  </p>

                  <div className="flex flex-wrap gap-2">
                    <form action={toggleAnnouncementPinnedAction}>
                      <input type="hidden" name="announcementId" value={item.id} />
                      <button
                        type="submit"
                        className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-50"
                      >
                        {item.pinned ? "取消置顶" : "置顶"}
                      </button>
                    </form>

                    <form action={deleteAnnouncementAction}>
                      <input type="hidden" name="announcementId" value={item.id} />
                      <button
                        type="submit"
                        className="rounded-lg border border-red-200 px-3 py-1.5 text-xs text-red-600 hover:bg-red-50"
                      >
                        删除
                      </button>
                    </form>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}
