import type { Metadata } from "next";
import { Pagination } from "@/components/pagination";
import { PostCard } from "@/components/post-card";
import { PostFilters } from "@/components/post-filters";
import { SearchBox } from "@/components/search-box";
import { prisma } from "@/lib/db";
import { filtersToQuery, listPosts, parseFilters } from "@/lib/post-query";

export const metadata: Metadata = {
  title: "全部信息 · 校园失物招领平台",
  description: "按类型、类别、时间与地点筛选校园失物招领信息",
};

/** 公开信息流（CLFP-USR-0006） */
export default async function PostsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const filters = parseFilters(params);

  const [categories, result] = await Promise.all([
    prisma.category.findMany({
      where: { enabled: true },
      orderBy: { sortOrder: "asc" },
      select: { id: true, name: true },
    }),
    listPosts(filters),
  ]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="section-heading text-2xl font-bold text-slate-900">全部信息</h1>
          <p className="mt-1 text-sm text-slate-500">
            共 <span className="font-medium text-slate-800">{result.total}</span> 条，按发布时间倒序；
            筛选条件会保留在网址里，可以直接分享。
          </p>
        </div>
        <div className="sm:w-72">
          <SearchBox />
        </div>
      </div>

      <PostFilters filters={filters} categories={categories} />

      {result.items.length === 0 ? (
        <div className="paper-panel border-dashed p-10 text-center">
          <span className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-lg border-2 border-[#d9b894] bg-[#dceee7] text-3xl" aria-hidden="true">🔎</span>
          <p className="text-sm text-slate-600">当前筛选条件下没有找到信息。</p>
          <p className="mt-1 text-xs text-slate-500">
            可以试试放宽时间范围或清除筛选条件。
          </p>
        </div>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {result.items.map((post) => (
            <li key={post.id}>
              <PostCard post={post} />
            </li>
          ))}
        </ul>
      )}

      <Pagination
        page={result.page}
        totalPages={result.totalPages}
        basePath="/posts"
        base={filtersToQuery(filters)}
      />
    </div>
  );
}
