import type { Metadata } from "next";
import Link from "next/link";
import { PasswordForm } from "@/components/password-form";
import { NotificationPreferenceForm } from "@/components/notification-preference-form";
import { ProfileForm } from "@/components/profile-form";
import { Card } from "@/components/ui";
import { decryptField } from "@/lib/crypto";
import { DEFAULT_QUIET_END, DEFAULT_QUIET_START, getNotificationPreference } from "@/lib/notifications";
import { requireUser } from "@/lib/session";
import { prisma } from "@/lib/db";

export const metadata: Metadata = { title: "账号设置 · 校园失物招领平台" };

export default async function SettingsPage() {
  const user = await requireUser();

  // 自己的资料才解密回填，便于修改
  const phone = user.phoneEncrypted ? (decryptField(user.phoneEncrypted) ?? "") : "";

  const activeSessions = await prisma.session.count({ where: { userId: user.id } });
  const preference = await getNotificationPreference(user.id);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">账号设置</h1>
        <p className="mt-1 text-sm text-slate-500">
          登录邮箱 <span className="text-slate-700">{user.email}</span>
          {" · "}
          当前有 {activeSessions} 个登录会话
        </p>
      </div>

      <Card title="个人资料" description="昵称会公开显示，校内资料仅用于身份核验。">
        <ProfileForm
          mode="settings"
          defaults={{
            nickname: user.nickname,
            realName: user.realName ?? "",
            studentNo: user.studentNo ?? "",
            department: user.department ?? "",
            phone,
          }}
        />
      </Card>

      <Card
        title="通知偏好"
        description="控制接收哪些提醒，以及免打扰时段（CLFP-USR-0019）。"
      >
        <NotificationPreferenceForm
          defaults={{
            inApp: preference?.inApp ?? true,
            email: preference?.email ?? false,
            quietEnabled: preference?.quietEnabled ?? true,
            quietStart: preference?.quietStart ?? DEFAULT_QUIET_START,
            quietEnd: preference?.quietEnd ?? DEFAULT_QUIET_END,
          }}
        />
      </Card>

      <Card title="修改密码" description="修改后其它设备需要重新登录。">
        <PasswordForm />
      </Card>

      <p className="text-sm text-slate-500">
        想查看自己的资料汇总？
        <Link href="/me" className="text-sky-600 hover:underline">
          去个人中心
        </Link>
      </p>
    </div>
  );
}
