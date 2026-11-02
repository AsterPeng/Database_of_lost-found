import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "账号无法使用 · 校园失物招领平台" };

/** 账号被管理员禁用或归档时的说明页（CLFP-USR-0002） */
export default function BannedPage() {
  return (
    <div className="mx-auto max-w-md text-center">
      <h1 className="text-xl font-semibold text-slate-900">账号当前无法使用</h1>
      <p className="mt-3 text-sm leading-6 text-slate-600">
        你的账号可能已被管理员禁用，或因为毕业/离职被归档。
        如果认为这是误操作，请联系平台管理员处理。
      </p>
      <Link
        href="/login"
        className="mt-6 inline-block rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50"
      >
        返回登录页
      </Link>
    </div>
  );
}
