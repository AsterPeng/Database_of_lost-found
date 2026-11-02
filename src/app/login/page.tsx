import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { LoginForm } from "@/components/login-form";
import { getCurrentUser } from "@/lib/session";

export const metadata: Metadata = { title: "登录 · 校园失物招领平台" };

export default async function LoginPage() {
  const user = await getCurrentUser();
  if (user) redirect(user.profileCompleted ? "/me" : "/onboarding");

  return (
    <div className="mx-auto max-w-md">
      <h1 className="section-heading text-2xl font-bold text-slate-900">登录</h1>
      <p className="mt-1 text-sm text-slate-500">登录后即可发布与认领物品信息。</p>
      <div className="paper-panel mt-6 p-6">
        <LoginForm />
      </div>
    </div>
  );
}
