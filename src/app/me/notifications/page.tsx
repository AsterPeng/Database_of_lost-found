import type { Metadata } from "next";
import Link from "next/link";
import {
  NOTIFICATION_TYPE_LABEL,
  NOTIFICATION_TYPE_STYLE,
} from "@/lib/notifications";
import { prisma } from "@/lib/db";
import { formatDateTime, formatRelative } from "@/lib/datetime";
import { requireUser } from "@/lib/session";
import {
  markAllNotificationsReadAction,
  markNotificationReadAction,
} from "@/server/notification-actions";

export const metadata: Metadata = { title: "通知中心 · 校园失物招领平台" };

/** 通知中心（CLFP-USR-0013） */
export default async function NotificationsPage() {
  const user = await requireUser();
  const now = new Date();

  const [delivered, queuedCount, nextDelivery, unreadCount] = await Promise.all([
    prisma.notification.findMany({
      where: { userId: user.id, deliverAt: { lte: now } },
      orderBy: { createdAt: "desc" },
      take: 50,
    }),
    prisma.notification.count({ where: { userId: user.id, deliverAt: { gt: now } } }),
    prisma.notification.findFirst({
      where: { userId: user.id, deliverAt: { gt: now } },
      orderBy: { deliverAt: "asc" },
      select: { deliverAt: true },
    }),
    prisma.notification.count({ where: { userId: user.id, readAt: null, deliverAt: { lte: now } } }),
  ]);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">通知中心</h1>
          <p className="mt-1 text-sm text-slate-500">
            匹配推荐、认领申请、审核结果与交接提醒都会在这里提醒你。
          </p>
        </div>
        {unreadCount > 0 ? (
          <form action={markAllNotificationsReadAction}>
            <button
              type="submit"
              className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50"
            >
              全部标为已读（{unreadCount}）
            </button>
          </form>
        ) : null}
      </div>

      {queuedCount > 0 ? (
        <div className="rounded-xl border border-purple-200 bg-purple-50 px-4 py-3 text-sm text-purple-800">
          有 <span className="font-semibold">{queuedCount}</span> 条通知处于免打扰时段，
          已为你暂缓发送
          {nextDelivery ? `，将于 ${formatDateTime(nextDelivery.deliverAt)} 后陆续送达` : ""}。
          可以在
          <Link href="/settings" className="mx-1 underline">
            账号设置
          </Link>
          中调整免打扰时段。
        </div>
      ) : null}

      {delivered.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center">
          <p className="text-sm text-slate-600">暂时没有通知。</p>
          <p className="mt-1 text-xs text-slate-500">
            发布信息后，匹配到相关内容、有人申请认领时会在这里提醒你。
          </p>
        </div>
      ) : (
        <ul className="space-y-3">
          {delivered.map((item) => (
            <li
              key={item.id}
              className={`rounded-xl border bg-white p-4 ${
                item.readAt ? "border-slate-200" : "border-sky-300"
              }`}
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className={`rounded px-2 py-0.5 text-xs ${NOTIFICATION_TYPE_STYLE[item.type]}`}>
                  {NOTIFICATION_TYPE_LABEL[item.type]}
                </span>
                {!item.readAt ? (
                  <span className="rounded bg-sky-100 px-2 py-0.5 text-xs text-sky-700">未读</span>
                ) : null}
                <span className="text-xs text-slate-400">{formatRelative(item.createdAt)}</span>
              </div>

              <p className="mt-2 text-sm font-medium text-slate-900">{item.title}</p>
              <p className="mt-1 text-sm text-slate-600">{item.body}</p>

              <div className="mt-3 flex flex-wrap items-center gap-3">
                {item.link ? (
                  <Link href={item.link} className="text-sm text-sky-600 hover:underline">
                    查看详情 →
                  </Link>
                ) : null}
                {!item.readAt ? (
                  <form action={markNotificationReadAction}>
                    <input type="hidden" name="notificationId" value={item.id} />
                    <button type="submit" className="text-sm text-slate-500 hover:text-slate-700">
                      标为已读
                    </button>
                  </form>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
