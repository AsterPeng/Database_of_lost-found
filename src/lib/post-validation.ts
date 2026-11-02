/** 帖子表单的校验规则（CLFP-USR-0003、0004） */
import { z } from "zod";

export const postSchema = z.object({
  type: z.enum(["LOST", "FOUND"], { message: "请选择信息类型" }),
  title: z.string().trim().min(2, "标题至少 2 个字").max(40, "标题最多 40 个字"),
  categoryId: z.string().trim().min(1, "请选择物品类别"),
  location: z.string().trim().min(2, "请填写地点").max(40, "地点最多 40 个字"),
  description: z.string().trim().min(5, "特征描述至少 5 个字").max(1000, "特征描述最多 1000 字"),
  occurredAt: z.string().trim().min(1, "请选择时间"),
});

/** datetime-local 传入的是本地时间字符串，这里转成 Date 并校验合理性 */
export function parseOccurredAt(value: string): { date?: Date; error?: string } {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return { error: "时间格式不正确" };

  const oneDayAhead = Date.now() + 24 * 60 * 60 * 1000;
  if (date.getTime() > oneDayAhead) return { error: "时间不能晚于当前时间" };

  const tenYearsAgo = Date.now() - 10 * 365 * 24 * 60 * 60 * 1000;
  if (date.getTime() < tenYearsAgo) return { error: "时间过于久远，请检查" };

  return { date };
}
