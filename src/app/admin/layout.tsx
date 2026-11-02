import type { ReactNode } from "react";
import { AdminNav } from "@/components/admin-nav";
import { requireAdmin } from "@/lib/session";

/** 管理后台外壳：非管理员会被直接跳走 */
export default async function AdminLayout({ children }: { children: ReactNode }) {
  await requireAdmin();

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="section-heading text-2xl font-bold text-slate-900">管理后台</h1>
          <p className="mt-1 text-sm text-slate-500">
            内容审核、操作日志与平台配置；所有操作都会记入日志。
          </p>
        </div>
        <AdminNav />
      </div>

      {children}
    </div>
  );
}
