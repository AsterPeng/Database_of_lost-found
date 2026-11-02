/**
 * 顶部导航：展示登录态（服务端渲染）。
 */
import Link from "next/link";
import { countUnreadNotifications } from "@/lib/notifications";
import { getCurrentUser } from "@/lib/session";
import { logoutAction } from "@/server/auth-actions";

export async function SiteHeader() {
  const user = await getCurrentUser();
  const unreadCount = user ? await countUnreadNotifications(user.id) : 0;

  return (
    <header className="sticky top-0 z-30 border-b-2 border-[#decaa6] bg-[#fffaf0]/92 shadow-[0_4px_0_rgba(169,129,86,0.07)] backdrop-blur-lg">
      <nav className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-6 py-3">
        <Link href="/" className="group flex shrink-0 items-center gap-2.5 font-bold text-slate-900">
          <span className="grid h-10 w-10 place-items-center rounded-lg border-2 border-[#a9473a] bg-[#e77b5e] text-lg font-bold text-white shadow-[2px_3px_0_#a9473a] transition group-hover:-rotate-6 group-hover:scale-105">
            拾
          </span>
          <span className="hidden sm:inline">校园失物招领</span>
        </Link>

        <div className="flex items-center gap-2 text-[13px] sm:gap-3">
          <Link href="/posts" className="nav-link font-medium text-slate-700 hover:text-sky-700">
            全部信息
          </Link>
          {user ? (
            <>
              <Link
                href="/posts/new"
                className="rounded-lg border-2 border-[#a9473a] bg-[#d86b54] px-3.5 py-1.5 font-bold text-white shadow-[2px_3px_0_#a9473a] hover:-translate-y-0.5 hover:bg-[#c95d49]"
              >
                发布
              </Link>
              <Link href="/me/posts" className="nav-link text-slate-600 hover:text-sky-700">
                我的发布
              </Link>
              <Link href="/me/matches" className="nav-link text-slate-600 hover:text-sky-700">
                我的匹配
              </Link>
              <Link href="/me/claims" className="nav-link text-slate-600 hover:text-sky-700">
                我的认领
              </Link>
              <Link
                href="/me/notifications"
                className="nav-link relative text-slate-600 hover:text-sky-700"
              >
                通知
                {unreadCount > 0 ? (
                  <span className="absolute -right-3.5 -top-2 grid h-4 min-w-4 place-items-center rounded-full bg-amber-500 px-1 text-[10px] font-bold text-white shadow-sm">
                    {unreadCount > 99 ? "99+" : unreadCount}
                  </span>
                ) : null}
              </Link>
              <Link href="/me" className="nav-link hidden text-slate-600 hover:text-sky-700 sm:inline">
                我的
              </Link>
              <Link href="/settings" className="nav-link hidden text-slate-600 hover:text-sky-700 sm:inline">
                账号设置
              </Link>
              {user.role === "ADMIN" ? (
                <Link href="/admin" className="nav-link text-slate-600 hover:text-sky-700">
                  管理后台
                </Link>
              ) : null}
              <span className="hidden h-5 w-px bg-[#d6c3a5] sm:inline" />
              <span className="hidden text-slate-700 md:inline">{user.nickname}</span>
              <form action={logoutAction} className="shrink-0">
                <button type="submit" className="rounded px-1.5 py-1 text-slate-600 hover:bg-red-50 hover:text-red-700">
                  退出
                </button>
              </form>
            </>
          ) : (
            <>
              <Link href="/login" className="nav-link text-slate-600 hover:text-sky-700">
                登录
              </Link>
              <Link
                href="/register"
                className="rounded-lg border-2 border-[#a9473a] bg-[#d86b54] px-3.5 py-1.5 font-bold text-white shadow-[2px_3px_0_#a9473a] hover:-translate-y-0.5 hover:bg-[#c95d49]"
              >
                注册
              </Link>
            </>
          )}
        </div>
      </nav>
    </header>
  );
}
