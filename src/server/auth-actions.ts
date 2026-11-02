"use server";

/**
 * 账号相关的服务端动作：注册、登录、退出、完善资料、修改密码、改密码。
 * 所有校验都在服务端重做一遍，前端校验只是体验优化（CLFP-USR-0022 的安全要求）。
 */
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { encryptField, hashPassword, maskPhone, verifyPassword } from "@/lib/crypto";
import { createSession, destroySession, requireUser } from "@/lib/session";
import {
  changePasswordSchema,
  loginSchema,
  profileSchema,
  registerSchema,
  settingsProfileSchema,
  toFieldErrors,
} from "@/lib/validation";
import type { FormState } from "@/lib/form-state";

/** 取表单字段并转为字符串，避免 null 直接进入校验 */
function text(formData: FormData, key: string): string {
  return String(formData.get(key) ?? "").trim();
}

async function sessionMeta() {
  const headerList = await headers();
  return {
    userAgent: headerList.get("user-agent"),
    ip: headerList.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
  };
}

/** 注册：邮箱 + 密码 + 昵称，成功后直接登录并进入资料补充页 */
export async function registerAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = registerSchema.safeParse({
    email: text(formData, "email"),
    nickname: text(formData, "nickname"),
    password: String(formData.get("password") ?? ""),
    confirmPassword: String(formData.get("confirmPassword") ?? ""),
  });
  if (!parsed.success) return { fieldErrors: toFieldErrors(parsed.error) };

  const { email, nickname, password } = parsed.data;

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    return { fieldErrors: { email: "该邮箱已注册，请直接登录" } };
  }

  const user = await prisma.user.create({
    data: { email, nickname, passwordHash: await hashPassword(password) },
  });

  await createSession(user.id, await sessionMeta());
  redirect("/onboarding");
}

/** 登录 */
export async function loginAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = loginSchema.safeParse({
    email: text(formData, "email"),
    password: String(formData.get("password") ?? ""),
  });
  if (!parsed.success) return { fieldErrors: toFieldErrors(parsed.error) };

  const user = await prisma.user.findUnique({ where: { email: parsed.data.email } });

  // 邮箱不存在与密码错误返回同一句提示，避免暴露账号是否注册
  if (!user || !(await verifyPassword(parsed.data.password, user.passwordHash))) {
    return { error: "邮箱或密码不正确" };
  }
  if (user.status === "BANNED") {
    return { error: "账号已被禁用，请联系管理员" };
  }
  if (user.status === "ARCHIVED") {
    return { error: "账号已归档，请联系管理员恢复" };
  }

  await createSession(user.id, await sessionMeta());
  redirect(user.profileCompleted ? "/" : "/onboarding");
}

/** 退出登录 */
export async function logoutAction(): Promise<void> {
  await destroySession();
  redirect("/");
}

/** 首次登录补充校内身份资料（CLFP-USR-0001） */
export async function completeProfileAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const user = await requireUser();

  const parsed = profileSchema.safeParse({
    realName: text(formData, "realName"),
    studentNo: text(formData, "studentNo"),
    department: text(formData, "department"),
    phone: text(formData, "phone"),
  });
  if (!parsed.success) return { fieldErrors: toFieldErrors(parsed.error) };

  const { realName, studentNo, department, phone } = parsed.data;

  await prisma.user.update({
    where: { id: user.id },
    data: {
      realName,
      studentNo,
      department,
      phoneEncrypted: encryptField(phone),
      phoneMasked: maskPhone(phone),
      profileCompleted: true,
    },
  });

  redirect("/me?welcome=1");
}

/** 账号设置：修改昵称与校内资料 */
export async function updateProfileAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const user = await requireUser();

  const parsed = settingsProfileSchema.safeParse({
    nickname: text(formData, "nickname"),
    realName: text(formData, "realName"),
    studentNo: text(formData, "studentNo"),
    department: text(formData, "department"),
    phone: text(formData, "phone"),
  });
  if (!parsed.success) return { fieldErrors: toFieldErrors(parsed.error) };

  const { nickname, realName, studentNo, department, phone } = parsed.data;

  await prisma.user.update({
    where: { id: user.id },
    data: {
      nickname,
      realName,
      studentNo,
      department,
      phoneEncrypted: encryptField(phone),
      phoneMasked: maskPhone(phone),
      profileCompleted: true,
    },
  });

  return { success: "资料已保存" };
}

/** 修改密码：改完后注销该账号的其它登录会話，只保留当前设备 */
export async function changePasswordAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const user = await requireUser();

  const parsed = changePasswordSchema.safeParse({
    currentPassword: String(formData.get("currentPassword") ?? ""),
    newPassword: String(formData.get("newPassword") ?? ""),
    confirmPassword: String(formData.get("confirmPassword") ?? ""),
  });
  if (!parsed.success) return { fieldErrors: toFieldErrors(parsed.error) };

  const ok = await verifyPassword(parsed.data.currentPassword, user.passwordHash);
  if (!ok) return { fieldErrors: { currentPassword: "当前密码不正确" } };

  await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash: await hashPassword(parsed.data.newPassword) },
  });

  // 清掉全部旧会话，再为当前设备建立新会话
  await prisma.session.deleteMany({ where: { userId: user.id } });
  await createSession(user.id, await sessionMeta());

  return { success: "密码已更新，其它设备需要重新登录" };
}
