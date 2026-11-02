/** 搜索框：普通 GET 表单，禁用 JavaScript 也能用 */
export function SearchBox({
  defaultValue = "",
  action = "/search",
  size = "md",
  placeholder = "例如：黑色保温杯 图书馆",
}: {
  defaultValue?: string;
  action?: string;
  size?: "md" | "lg";
  placeholder?: string;
}) {
  const inputClass =
    size === "lg"
      ? "min-w-0 w-full rounded-l-md border-2 border-r-0 px-4 py-3 text-base outline-none placeholder:text-slate-400"
      : "min-w-0 w-full rounded-l-md border-2 border-r-0 px-3.5 py-2.5 text-sm outline-none placeholder:text-slate-400";
  const buttonClass =
    size === "lg"
      ? "shrink-0 rounded-r-md border-2 border-[#a9473a] bg-[#d86b54] px-6 py-3 text-base font-bold text-white hover:bg-[#c95d49]"
      : "shrink-0 rounded-r-md border-2 border-[#a9473a] bg-[#d86b54] px-4 py-2.5 text-sm font-bold text-white hover:bg-[#c95d49]";

  return (
    <form action={action} method="get" className="flex w-full">
      <input
        type="search"
        name="q"
        defaultValue={defaultValue}
        placeholder={placeholder}
        className={inputClass}
        aria-label="搜索失物招领信息"
      />
      <button type="submit" className={buttonClass}>
        搜索
      </button>
    </form>
  );
}
