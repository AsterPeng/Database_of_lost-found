import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { RegisterForm } from "@/components/register-form";
import { getCurrentUser } from "@/lib/session";

export const metadata: Metadata = { title: "注册 · 校园失物招领平台" };

export default async function RegisterPage() {
  const user = await getCurrentUser();
  if (user) redirect(user.profileCompleted ? "/me" : "/onboarding");

  return (
    <div className="mx-auto max-w-md">
      <h1 className="section-heading text-2xl font-bold text-slate-900">注册</h1>
      <p className="mt-1 text-sm text-slate-500">
        注册后需要补充姓名、学号、院系与手机号，用于校内身份核验。
      </p>
      <div className="paper-panel mt-6 p-6">
        <RegisterForm />
      </div>
    </div>
  );
}
