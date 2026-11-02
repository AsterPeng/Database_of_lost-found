/**
 * 环境变量读取与校验。
 * 只在服务端使用；缺少关键变量时直接启动失败，避免带着错误配置运行。
 */
import { z } from "zod";

const schema = z.object({
  DATABASE_URL: z.string().min(1, "缺少 DATABASE_URL"),
  /// 32 字节 base64 密钥，用于手机号等敏感字段的字段级加密
  ENCRYPTION_KEY: z.string().min(1, "缺少 ENCRYPTION_KEY"),
  /// 登录态有效期（天）
  SESSION_DAYS: z.coerce.number().int().positive().default(30),
});

const parsed = schema.safeParse({
  DATABASE_URL: process.env.DATABASE_URL,
  ENCRYPTION_KEY: process.env.ENCRYPTION_KEY,
  SESSION_DAYS: process.env.SESSION_DAYS ?? "30",
});

if (!parsed.success) {
  const detail = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
  throw new Error(`环境变量配置有误：${detail}`);
}

export const env = parsed.data;
