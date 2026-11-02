/** 信息流筛选栏（CLFP-USR-0006）：条件全部体现在 URL 上 */
import Link from "next/link";
import { PRESET_LOCATIONS } from "@/lib/constants";
import {
  filtersToQuery,
  STATUS_OPTIONS,
  TIME_RANGES,
  TYPE_OPTIONS,
  type ListFilters,
} from "@/lib/post-query";
import { buildQueryString } from "@/lib/url";

type Category = { id: string; name: string };

function Chip({
  href,
  active,
  tone = "coral",
  children,
}: {
  href: string;
  active: boolean;
  tone?: "coral" | "mint" | "sun";
  children: React.ReactNode;
}) {
  const activeClass = {
    coral: "border-[#c86b52] bg-[#ffdfc7] text-[#8a3f35] shadow-[2px_2px_0_#d7a784]",
    mint: "border-[#62a798] bg-[#dceee7] text-[#216a62] shadow-[2px_2px_0_#a4cbbf]",
    sun: "border-[#c7984f] bg-[#fff0bd] text-[#79552a] shadow-[2px_2px_0_#dbc28c]",
  }[tone];
  return (
    <Link
      href={href}
      className={`rounded-md border-2 px-3 py-1.5 text-xs font-medium transition hover:-translate-y-0.5 ${
        active
          ? activeClass
          : "border-[#e2d5bd] bg-[#fffdf8] text-slate-700 hover:border-[#d0a381] hover:bg-[#fff5df]"
      }`}
    >
      {children}
    </Link>
  );
}

export function PostFilters({
  filters,
  categories,
  basePath = "/posts",
}: {
  filters: ListFilters;
  categories: Category[];
  basePath?: string;
}) {
  const base = filtersToQuery(filters);

  const link = (overrides: Record<string, string | undefined>) =>
    `${basePath}${buildQueryString(base, { ...overrides, page: undefined })}`;

  const hasFilter = Boolean(
    base.type || base.categoryId || base.location || base.range || base.status,
  );

  return (
    <div className="paper-panel space-y-3 p-5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium text-slate-500">类型</span>
        {TYPE_OPTIONS.map((option) => (
          <Chip
            key={option.key}
            href={link({ type: option.key === "ALL" ? undefined : option.key })}
            active={filters.type === option.key}
            tone={option.key === "FOUND" ? "mint" : option.key === "ALL" ? "sun" : "coral"}
          >
            {option.label}
          </Chip>
        ))}

        <span className="ml-2 text-xs font-medium text-slate-500">状态</span>
        {STATUS_OPTIONS.map((option) => (
          <Chip
            key={option.key}
            href={link({ status: option.key === "OPEN" ? undefined : option.key })}
            active={filters.status === option.key}
          >
            {option.label}
          </Chip>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium text-slate-500">类别</span>
        <Chip href={link({ categoryId: undefined })} active={!filters.categoryId}>
          全部
        </Chip>
        {categories.map((category) => (
          <Chip
            key={category.id}
            href={link({ categoryId: category.id })}
            active={filters.categoryId === category.id}
          >
            {category.name}
          </Chip>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium text-slate-500">时间</span>
        {TIME_RANGES.map((range) => (
          <Chip
            key={range.key}
            href={link({ range: range.key === "all" ? undefined : range.key })}
            active={filters.range === range.key}
          >
            {range.label}
          </Chip>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium text-slate-500">地点</span>
        <Chip href={link({ location: undefined })} active={!filters.location}>
          全部
        </Chip>
        {PRESET_LOCATIONS.filter((location) => location !== "其它").map((location) => (
          <Chip
            key={location}
            href={link({ location })}
            active={filters.location === location}
          >
            {location}
          </Chip>
        ))}
      </div>

      {hasFilter ? (
        <div className="pt-1">
          <Link
            href={basePath}
            className="text-xs text-slate-500 underline-offset-2 hover:text-red-600 hover:underline"
          >
            清除全部筛选
          </Link>
        </div>
      ) : null}
    </div>
  );
}
