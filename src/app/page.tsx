import Link from "next/link";
import { PostCard } from "@/components/post-card";
import { SearchBox } from "@/components/search-box";
import { listActiveAnnouncements } from "@/lib/announcements";
import { getCurrentUser } from "@/lib/session";
import { latestPosts } from "@/lib/post-query";

export default async function HomePage() {
  const [user, lostPosts, foundPosts, announcements] = await Promise.all([
    getCurrentUser(),
    latestPosts("LOST", 4),
    latestPosts("FOUND", 4),
    listActiveAnnouncements(3),
  ]);

  const hasPost = lostPosts.length > 0 || foundPosts.length > 0;

  return (
    <div className="space-y-9">
      {announcements.length > 0 ? (
        <section className="space-y-2.5" aria-label="校园公告">
          {announcements.map((item) => (
            <div key={item.id} className={`paper-panel surface-hover px-5 py-3.5 ${item.pinned ? "border-amber-300 bg-amber-50" : ""}`}>
              <p className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                <span className={`rounded px-2 py-0.5 text-xs ${item.pinned ? "bg-amber-200 text-amber-900" : "bg-teal-100 text-teal-800"}`}>
                  {item.pinned ? "置顶公告" : "公告"}
                </span>
                {item.title}
              </p>
              <p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-slate-600">{item.body}</p>
            </div>
          ))}
        </section>
      ) : null}

      <section className="hero-surface px-8 py-9 lg:px-11 lg:py-11">
        <div className="hero-copy">
          <p className="hero-kicker text-xs">校园失物招领 · 每一条线索都重要</p>
          <h1 className="mt-5 text-4xl font-extrabold leading-[1.35] text-slate-900">
            丢了什么？<br />
            <span className="hero-title-highlight">一起把它找回来。</span>
          </h1>
          <p className="mt-4 max-w-[27rem] text-sm leading-7 text-slate-700">
            从教室到操场，从一张校园卡到一本书。在这里发布线索、寻找物品，和同学完成认领交接。
          </p>
          <div className="mt-6 max-w-[29rem] rounded-lg border-2 border-[#d9b792] bg-white/75 p-1 shadow-[3px_4px_0_rgba(126,88,55,0.12)]">
            <SearchBox size="lg" />
          </div>
          <div className="mt-5 flex flex-wrap gap-3">
            <Link href={user ? "/posts/new" : "/register"} className="inline-flex items-center rounded-lg border-2 border-[#a74739] bg-[#d86b54] px-4 py-2.5 text-sm font-bold text-white shadow-[3px_4px_0_#a74739] hover:-translate-y-1 hover:bg-[#c95d49] hover:shadow-[4px_6px_0_#a74739]">
              {user ? "发布寻物 / 拾物信息" : "注册账号，发布线索"}
            </Link>
            <Link href={user ? "/me/posts" : "/posts"} className="inline-flex items-center rounded-lg border-2 border-[#9f8970] bg-[#fff9e9] px-4 py-2.5 text-sm font-bold text-slate-800 shadow-[3px_4px_0_#c9b090] hover:-translate-y-1 hover:bg-white hover:shadow-[4px_6px_0_#c9b090]">
              {user ? "我的发布" : "看看大家发布了什么"}
            </Link>
          </div>
        </div>
      </section>

      <section aria-label="快速入口" className="grid gap-4 md:grid-cols-3">
        <Link href="/posts?type=LOST" className="quick-link flex items-center gap-4 bg-[#ffe4d7] px-5 py-4 text-slate-900">
          <span className="quick-link-icon" aria-hidden="true">🎒</span>
          <span><strong className="block text-base">看看谁在寻找</strong><span className="mt-1 block text-xs text-slate-600">浏览最新寻物启事 →</span></span>
        </Link>
        <Link href="/posts?type=FOUND" className="quick-link flex items-center gap-4 bg-[#dceee7] px-5 py-4 text-slate-900">
          <span className="quick-link-icon" aria-hidden="true">🔑</span>
          <span><strong className="block text-base">看看谁捡到了</strong><span className="mt-1 block text-xs text-slate-600">浏览最新拾物信息 →</span></span>
        </Link>
        <Link href={user ? "/posts/new" : "/login"} className="quick-link flex items-center gap-4 bg-[#fff0bd] px-5 py-4 text-slate-900">
          <span className="quick-link-icon" aria-hidden="true">📌</span>
          <span><strong className="block text-base">发布一条新线索</strong><span className="mt-1 block text-xs text-slate-600">让更多同学帮忙留意 →</span></span>
        </Link>
      </section>

      {hasPost ? (
        <section className="space-y-5">
          <div className="flex items-end justify-between border-b-2 border-dashed border-[#d7c6a9] pb-3">
            <div><p className="text-xs font-bold text-[#ad7058]">校园里的新线索</p><h2 className="section-heading mt-1 text-xl font-bold">最新信息</h2></div>
            <Link href="/posts" className="text-sm font-semibold text-sky-700 hover:underline">查看全部 →</Link>
          </div>
          <div className="grid gap-8 md:grid-cols-2">
            <div className="space-y-3">
              <h3 className="section-heading text-base font-bold">最新寻物启事</h3>
              {lostPosts.length === 0 ? <p className="paper-panel p-5 text-sm text-slate-500">暂时没有寻物启事</p> : (
                <ul className="space-y-3">{lostPosts.map((post) => <li key={post.id}><PostCard post={post} /></li>)}</ul>
              )}
            </div>
            <div className="space-y-3">
              <h3 className="section-heading teal text-base font-bold">最新拾物信息</h3>
              {foundPosts.length === 0 ? <p className="paper-panel p-5 text-sm text-slate-500">暂时没有拾物信息</p> : (
                <ul className="space-y-3">{foundPosts.map((post) => <li key={post.id}><PostCard post={post} /></li>)}</ul>
              )}
            </div>
          </div>
        </section>
      ) : (
        <section className="paper-panel py-9 text-center">
          <span className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-lg border-2 border-[#d9b894] bg-[#fff0bd] text-3xl shadow-[3px_4px_0_#e4d0a9]" aria-hidden="true">📌</span>
          <p className="text-base font-semibold text-slate-800">校园里还没有发布的信息</p>
          <p className="mt-2 text-sm text-slate-600">登录后可以发布第一条寻物启事或拾物信息。</p>
        </section>
      )}
    </div>
  );
}
