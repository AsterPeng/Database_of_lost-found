/**
 * 表单校验规则（zod）。
 * 只用最稳定的 API，避免 zod 大版本升级造成破坏。
 */
import { z } from "zod";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// 中国大陆手机号
const PHONE_RE = /^1[3-9]\d{9}$/;

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(EMAIL_RE, "请输入有效的邮箱地址");

export const passwordSchema = z
  .string()
  .min(8, "密码至少 8 位")
  .max(72, "密码最多 72 位");

export const registerSchema = z
  .object({
    email: emailSchema,
    nickname: z.string().trim().min(1, "请填写昵称").max(20, "昵称最多 20 个字"),
    password: passwordSchema,
    confirmPassword: z.string(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    path: ["confirmPassword"],
    message: "两次输入的密码不一致",
  });

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, "请输入密码"),
});

/** 校内身份资料：四项均为必填（CLFP-USR-0001） */
export const profileSchema = z.object({
  realName: z.string().trim().min(2, "请填写真实姓名").max(20, "姓名最多 20 个字"),
  studentNo: z
    .string()
    .trim()
    .min(4, "学号/工号至少 4 位")
    .max(20, "学号/工号最多 20 位")
    .regex(/^[A-Za-z0-9-]+$/, "学号/工号只能是字母、数字或短横线"),
  department: z.string().trim().min(2, "请填写所属院系").max(40, "院系最多 40 个字"),
  phone: z.string().trim().regex(PHONE_RE, "请输入有效的手机号"),
});

export const nicknameSchema = z.string().trim().min(1, "请填写昵称").max(20, "昵称最多 20 个字");

/** 账号设置页：昵称 + 校内资料 */
export const settingsProfileSchema = profileSchema.extend({ nickname: nicknameSchema });

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, "请输入当前密码"),
    newPassword: passwordSchema,
    confirmPassword: z.string(),
  })
  .refine((data) => data.newPassword === data.confirmPassword, {
    path: ["confirmPassword"],
    message: "两次输入的新密码不一致",
  });

/** 从 zod 错误中提取「字段 -> 第一条错误信息」，便于表单回显 */
export function toFieldErrors(error: z.ZodError): Record<string, string> {
  const result: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join(".") || "_form";
    if (!result[key]) result[key] = issue.message;
  }
  return result;
}
