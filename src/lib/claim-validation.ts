/** 认领表单的校验规则（CLFP-USR-0011、0012） */
import { z } from "zod";

export const claimSchema = z.object({
  message: z.string().trim().min(5, "认领说明至少 5 个字").max(500, "认领说明最多 500 字"),
  proof: z
    .string()
    .trim()
    .min(5, "请填写认领凭证，例如物品专属特征、购买凭证或存放位置")
    .max(500, "认领凭证最多 500 字"),
  contact: z
    .string()
    .trim()
    .min(5, "请填写联系方式，便于对方联系你")
    .max(100, "联系方式最多 100 个字符"),
});

export const handoverSchema = z.object({
  meetAt: z.string().trim().min(1, "请选择交接时间"),
  meetPlace: z.string().trim().min(2, "请填写交接地点").max(60, "交接地点最多 60 个字"),
});

/** datetime-local 的值转成 Date，并做合理性校验 */
export function parseMeetAt(value: string): { date?: Date; error?: string } {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return { error: "交接时间格式不正确" };

  const oneYearAgo = Date.now() - 365 * 24 * 60 * 60 * 1000;
  if (date.getTime() < oneYearAgo) return { error: "交接时间过于久远，请检查" };

  const oneYearAhead = Date.now() + 365 * 24 * 60 * 60 * 1000;
  if (date.getTime() > oneYearAhead) return { error: "交接时间过于遥远，请检查" };

  return { date };
}
