import type { Metadata } from "next";
import Link from "next/link";
import { Pagination } from "@/components/pagination";
import { PostCard } from "@/components/post-card";
import { PostFilters } from "@/components/post-filters";
import { SearchBox } from "@/components/search-box";
import { prisma } from "@/lib/db";
import { filtersToQuery, parseFilters, searchPosts, type SearchHit } from "@/lib/post-query";

export const metadata: Metadata = {
  title: "搜索 · 校园失物招领平台",
  description: "按关键词搜索物品名称、描述与地点",
};

/** 关键词搜索（CLFP-USR-0007）：结果按相关度排序，并分失物/拾物两组展示 */
export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const filters = parseFilters(params);
  const query = filters.q ?? "";

  const [categories, result] = await Promise.all([
    prisma.category.findMany({
      where: { enabled: true },
      orderBy: { sortOrder: "asc" },
      select: { id: true, name: true },
    }),
    query ? searchPosts(query, filters) : Promise.resolve(null),
  ]);

  const lost = result?.hits.filter((hit) => hit.type === "LOST") ?? [];
  const found = result?.hits.filter((hit) => hit.type === "FOUND") ?? [];

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <h1 className="section-heading text-2xl font-bold text-slate-900">搜索信息</h1>
        <SearchBox defaultValue={query} size="lg" />
        <p className="text-xs text-slate-500">
          可以输入物品名称、外观特征或地点，用空格分隔多个关键词，例如「保温杯 图书馆」。
        </p>
      </div>

      {!query ? (
        <div className="paper-panel border-dashed p-10 text-center">
          <span className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-lg border-2 border-[#d9b894] bg-[#fff0bd] text-3xl" aria-hidden="true">🔎</span>
          <p className="text-sm text-slate-600">输入关键词开始搜索。</p>
          <p className="mt-1 text-xs text-slate-500">
            也可以直接
            <Link href="/posts" className="mx-1 text-sky-600 hover:underline">
              浏览全部信息
            </Link>
            并按条件筛选。
          </p>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm text-slate-600">
              关键词
              {result?.tokens.map((token) => (
                <span
                  key={token}
                  className="ml-1.5 rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-700"
                >
                  {token}
                </span>
              ))}
              ，共找到 <span className="font-medium text-slate-900">{result?.total ?? 0}</span> 条
            </p>
          </div>

          <PostFilters filters={filters} categories={categories} basePath="/search" />

          {result && result.total === 0 ? (
            <div className="paper-panel border-dashed p-10 text-center">
              <span className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-lg border-2 border-[#d9b894] bg-[#ffe4d7] text-3xl" aria-hidden="true">🧭</span>
              <p className="text-sm text-slate-600">没有找到包含这些关键词的信息。</p>
              <p className="mt-1 text-xs text-slate-500">
                换一个说法，或者减少关键词数量再试一次。
              </p>
            </div>
          ) : (
            <div className="space-y-8">
              <ResultGroup title="寻物启事" hint="失主发布" hits={lost} />
              <ResultGroup title="拾物信息" hint="拾获者发布" hits={found} />
            </div>
          )}

          {result ? (
            <Pagination
              page={result.page}
              totalPages={result.totalPages}
              basePath="/search"
              base={filtersToQuery(filters)}
            />
          ) : null}
        </>
      )}
    </div>
  );
}

function ResultGroup({
  title,
  hint,
  hits,
}: {
  title: string;
  hint: string;
  hits: SearchHit[];
}) {
  if (hits.length === 0) return null;

  return (
    <section className="space-y-3">
      <div className="flex items-baseline gap-2">
        <h2 className="section-heading text-base font-bold text-slate-900">{title}</h2>
        <span className="text-xs text-slate-500">
          {hint} · {hits.length} 条
        </span>
      </div>

      <ul className="grid gap-3 sm:grid-cols-2">
        {hits.map((hit) => (
          <li key={hit.id} className="space-y-1.5">
            <PostCard post={hit} />
            <p className="px-1 text-xs text-slate-500">
              相关度 {hit.score.toFixed(2)}
              {hit.matchedIn.length > 0 ? ` · 命中${hit.matchedIn.join("、")}` : ""}
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}
