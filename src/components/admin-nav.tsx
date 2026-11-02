"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV = [
  { href: "/admin", label: "概览" },
  { href: "/admin/posts", label: "信息管理" },
  { href: "/admin/claims", label: "认领处理" },
  { href: "/admin/reports", label: "举报处理" },
  { href: "/admin/users", label: "用户管理" },
  { href: "/admin/announcements", label: "公告" },
  { href: "/admin/stats", label: "统计报表" },
  { href: "/admin/logs", label: "操作日志" },
  { href: "/admin/config", label: "配置中心" },
];

export function AdminNav() {
  const pathname = usePathname();

  return (
    <nav className="flex flex-wrap gap-2 text-sm">
      {NAV.map((item) => {
        const active = item.href === "/admin" ? pathname === "/admin" : pathname.startsWith(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            className={`rounded-md border-2 px-3 py-1.5 font-medium transition hover:-translate-y-0.5 ${
              active
                ? "border-[#c86b52] bg-[#ffdfc7] text-[#8a3f35]"
                : "border-[#e2d5bd] bg-[#fffdf8] text-slate-700 hover:border-[#d0a381] hover:bg-[#fff5df]"
            }`}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
