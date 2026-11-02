import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ProfileForm } from "@/components/profile-form";
import { requireUser } from "@/lib/session";

export const metadata: Metadata = { title: "完善校内资料 · 校园失物招领平台" };

/**
 * 首次登录后的资料补充页（CLFP-USR-0001）。
 * 四项资料齐全前，平台不开放发布与认领功能。
 */
export default async function OnboardingPage() {
  const user = await requireUser();
  if (user.profileCompleted) redirect("/me");

  return (
    <div className="mx-auto max-w-md">
      <h1 className="text-xl font-semibold text-slate-900">完善校内身份资料</h1>
      <p className="mt-1 text-sm text-slate-500">
        这些信息用于确认你的校内身份，手机号会加密存储，公开页面只显示脱敏结果。
      </p>
      <div className="mt-6 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <ProfileForm mode="onboarding" defaults={{ nickname: user.nickname }} />
      </div>
    </div>
  );
}
