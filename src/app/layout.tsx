import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";
import { SiteHeader } from "@/components/site-header";

export const metadata: Metadata = {
  title: "校园失物招领平台",
  description: "基于 RAG 语义匹配的校园失物招领平台",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="zh-CN">
      <body className="min-h-screen text-slate-900 antialiased">
        <div className="app-shell">
          <SiteHeader />
          <main className="mx-auto w-full max-w-6xl px-6 py-9">{children}</main>
          <footer className="mx-auto w-full max-w-6xl px-6 pb-9 pt-4 text-center text-xs text-slate-500">
            校园失物招领 · 让每条线索都有回音
          </footer>
        </div>
      </body>
    </html>
  );
}
