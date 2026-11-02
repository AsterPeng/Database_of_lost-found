/** 分页控件：保持当前筛选条件 */
import Link from "next/link";
import { buildQueryString } from "@/lib/url";

export function Pagination({
  page,
  totalPages,
  basePath,
  base,
}: {
  page: number;
  totalPages: number;
  basePath: string;
  base: Record<string, string | undefined>;
}) {
  if (totalPages <= 1) return null;

  const linkTo = (target: number) =>
    `${basePath}${buildQueryString(base, { page: target > 1 ? String(target) : undefined })}`;

  const pageClass = (active: boolean) =>
    `rounded-md border-2 px-3.5 py-2 text-sm font-semibold transition ${
      active
        ? "border-[#c86b52] bg-[#ffdfc7] text-[#8a3f35]"
        : "border-[#d4bea0] bg-[#fffdf8] text-slate-700 hover:-translate-y-0.5 hover:border-[#c86b52] hover:bg-[#fff5df]"
    }`;

  return (
    <nav className="flex flex-wrap items-center justify-center gap-2 pt-2">
      {page > 1 ? (
        <Link href={linkTo(page - 1)} className={pageClass(false)}>
          上一页
        </Link>
      ) : null}

      <span className="text-sm text-slate-500">
        第 <span className="font-medium text-slate-800">{page}</span> / {totalPages} 页
      </span>

      {page < totalPages ? (
        <Link href={linkTo(page + 1)} className={pageClass(false)}>
          下一页
        </Link>
      ) : null}
    </nav>
  );
}
