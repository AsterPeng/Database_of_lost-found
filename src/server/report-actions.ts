"use server";

/** 举报相关动作（CLFP-USR-0015） */
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { recordAudit } from "@/lib/audit";
import { prisma } from "@/lib/db";
import { notify } from "@/lib/notifications";
import { REPORT_REASONS } from "@/lib/reports";
import { requireAdmin, requireUser } from "@/lib/session";
import type { FormState } from "@/lib/form-state";

function text(formData: FormData, key: string): string {
  return String(formData.get(key) ?? "").trim();
}

/** 提交举报 */
export async function createReportAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser();

  const postId = text(formData, "postId");
  const reason = text(formData, "reason");
  const detail = text(formData, "detail");

  const post = await prisma.post.findFirst({
    where: { id: postId, deletedAt: null },
    select: { id: true, title: true, authorId: true },
  });
  if (!post) return { error: "信息不存在或已被删除" };
  if (post.authorId === user.id) return { error: "不能举报自己发布的信息" };
  if (!REPORT_REASONS.includes(reason as (typeof REPORT_REASONS)[number])) {
    return { fieldErrors: { reason: "请选择举报类型" } };
  }
  if (detail.length > 500) return { fieldErrors: { detail: "补充说明最多 500 字" } };

  const existing = await prisma.report.findUnique({
    where: {
      reporterId_targetType_targetId: {
        reporterId: user.id,
        targetType: "POST",
        targetId: post.id,
      },
    },
  });
  if (existing) return { error: "你已经举报过这条信息，管理员正在处理" };

  await prisma.report.create({
    data: {
      reporterId: user.id,
      targetType: "POST",
      targetId: post.id,
      reason,
      detail: detail || null,
    },
  });

  revalidatePath("/admin/reports");
  redirect("/me?reported=1");
}

/** 处理举报：受理（可选择同时下架）或驳回 */
export async function handleReportAction(formData: FormData): Promise<void> {
  const admin = await requireAdmin();

  const reportId = text(formData, "reportId");
  const decision = text(formData, "decision");
  const note = text(formData, "note");
  const takeDown = formData.get("takeDown") !== null;

  const report = await prisma.report.findUnique({ where: { id: reportId } });
  if (!report || report.status !== "PENDING") return;

  if (decision === "REJECT") {
    await prisma.report.update({
      where: { id: report.id },
      data: {
        status: "REJECTED",
        handledById: admin.id,
        handledAt: new Date(),
        handleNote: note || null,
      },
    });

    await recordAudit({
      operatorId: admin.id,
      action: "REPORT_REJECT",
      targetType: "POST",
      targetId: report.targetId,
      detail: { reportId: report.id, reason: report.reason, note },
    });

    revalidatePath("/admin/reports");
    return;
  }

  if (decision !== "RESOLVE") return;

  await prisma.report.update({
    where: { id: report.id },
    data: {
      status: "RESOLVED",
      handledById: admin.id,
      handledAt: new Date(),
      handleNote: note || null,
    },
  });

  if (takeDown) {
    const post = await prisma.post.findUnique({
      where: { id: report.targetId },
      select: { id: true, title: true, authorId: true, takenDownAt: true },
    });

    if (post && !post.takenDownAt) {
      const reason = `被举报（${report.reason}），管理员核实后下架`;
      await prisma.post.update({
        where: { id: post.id },
        data: { takenDownAt: new Date(), takeDownReason: reason, takenDownById: admin.id },
      });

      await notify({
        userId: post.authorId,
        type: "SYSTEM",
        title: "你发布的信息已被下架",
        body: `《${post.title}》因「${reason}」被下架。`,
        link: `/posts/${post.id}`,
      });

      revalidatePath("/posts");
      revalidatePath(`/posts/${post.id}`);
      revalidatePath("/");
    }
  }

  await recordAudit({
    operatorId: admin.id,
    action: "REPORT_RESOLVE",
    targetType: "POST",
    targetId: report.targetId,
    detail: { reportId: report.id, reason: report.reason, note, takeDown },
  });

  revalidatePath("/admin/reports");
  revalidatePath("/admin");
}
