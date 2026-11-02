"use server";

/**
 * 匹配反馈（CLFP-USR-0010）。
 * 反馈「不是我的」会立即把这条配对从双方列表中移除，并且不再重复推荐；
 * 所有反馈都会参与类别权重自适应。
 */
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { recomputeCategoryBoost } from "@/lib/rag/matching";
import { requireUser } from "@/lib/session";

const ALLOWED = new Set(["MINE", "NOT_MINE", "UNSURE", "NONE"]);

export async function submitMatchFeedbackAction(formData: FormData): Promise<void> {
  const user = await requireUser();

  const matchId = String(formData.get("matchId") ?? "").trim();
  const feedback = String(formData.get("feedback") ?? "").trim();
  if (!matchId || !ALLOWED.has(feedback)) return;

  const match = await prisma.match.findUnique({
    where: { id: matchId },
    include: {
      lostPost: { select: { authorId: true } },
      foundPost: { select: { authorId: true } },
    },
  });
  if (!match) return;

  // 只有配对双方可以反馈
  if (match.lostPost.authorId !== user.id && match.foundPost.authorId !== user.id) return;

  await prisma.match.update({
    where: { id: match.id },
    data: {
      feedback: feedback as "MINE" | "NOT_MINE" | "UNSURE" | "NONE",
      feedbackById: feedback === "NONE" ? null : user.id,
      feedbackAt: feedback === "NONE" ? null : new Date(),
    },
  });

  // 反馈会改变类别权重系数，这里立即重算，保证后续推荐马上生效
  await recomputeCategoryBoost();

  revalidatePath("/me/matches");
  revalidatePath("/me");
}
