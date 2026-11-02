"use server";

/**
 * 认领与交接的服务端动作（CLFP-USR-0011、0012、0014）。
 * 权限规则：只有帖子作者或管理员可以审核；只有当事双方可以查看详情、安排交接与授权联系方式。
 */
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { Prisma } from "@prisma/client";
import { claimSchema, handoverSchema, parseMeetAt } from "@/lib/claim-validation";
import { getClaimById, isClaimParty, ESCALATE_HOURS } from "@/lib/claims";
import { encryptField, maskContact } from "@/lib/crypto";
import { prisma } from "@/lib/db";
import { notify } from "@/lib/notifications";
import { requireUser } from "@/lib/session";
import { toFieldErrors } from "@/lib/validation";
import type { FormState } from "@/lib/form-state";

function text(formData: FormData, key: string): string {
  return String(formData.get(key) ?? "").trim();
}

function parseJson<T>(value: unknown): T {
  return (typeof value === "string" ? JSON.parse(value) : value) as T;
}

type ClaimReviewResult = {
  ok: boolean;
  code?: string;
  status?: "ACCEPTED" | "REJECTED";
  reviewerRole?: "OWNER" | "ADMIN";
  claimantId?: string;
  postId?: string;
  postTitle?: string;
  rejectedClaims?: Array<{ claimId: string; claimantId: string }>;
};

type HandoverResult = {
  ok: boolean;
  code?: string;
  completedAt?: string;
  completedById?: string;
};

function revalidateClaim(claimId: string, postId?: string) {
  revalidatePath("/me/claims");
  revalidatePath(`/me/claims/${claimId}`);
  revalidatePath("/admin/claims");
  revalidatePath(`/admin/claims/${claimId}`);
  revalidatePath("/admin");
  if (postId) revalidatePath(`/posts/${postId}`);
}

/** 提交认领申请（CLFP-USR-0011） */
export async function createClaimAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser();
  if (!user.profileCompleted) redirect("/onboarding");

  const postId = text(formData, "postId");
  const post = await prisma.post.findFirst({
    where: { id: postId, deletedAt: null, takenDownAt: null },
    select: { id: true, authorId: true, status: true, title: true },
  });
  if (!post) return { error: "信息不存在或已被删除" };
  if (post.authorId === user.id) return { error: "不能认领自己发布的信息" };
  if (post.status !== "OPEN") return { error: "这条信息已经结束认领" };

  const parsed = claimSchema.safeParse({
    message: text(formData, "message"),
    proof: text(formData, "proof"),
    contact: text(formData, "contact"),
  });
  if (!parsed.success) return { fieldErrors: toFieldErrors(parsed.error) };

  const existing = await prisma.claim.findUnique({
    where: { postId_claimantId: { postId: post.id, claimantId: user.id } },
  });
  if (existing?.status === "PENDING") return { error: "你已经提交过认领申请，请等待对方处理" };
  if (existing?.status === "ACCEPTED") return { error: "你的认领申请已经通过" };

  const data = {
    message: parsed.data.message,
    proof: parsed.data.proof,
    contactEncrypted: encryptField(parsed.data.contact),
    contactMasked: maskContact(parsed.data.contact),
    status: "PENDING" as const,
    reviewNote: null,
    reviewedById: null,
    reviewedAt: null,
    reviewerRole: null,
    escalatedAt: null,
    escalateAt: new Date(Date.now() + ESCALATE_HOURS * 60 * 60 * 1000),
  };

  // 被拒绝或撤回后允许重新申请，这里直接复用原记录
  const claim = existing
    ? await prisma.claim.update({ where: { id: existing.id }, data })
    : await prisma.claim.create({ data: { ...data, postId: post.id, claimantId: user.id } });

  // 通知信息发布者有人申请认领（CLFP-USR-0013）
  await notify({
    userId: post.authorId,
    type: "CLAIM_RECEIVED",
    title: "有人申请认领你发布的信息",
    body: `《${post.title}》收到一条认领申请，请在 48 小时内处理。`,
    link: `/me/claims/${claim.id}`,
  });

  revalidateClaim(claim.id, post.id);
  redirect(`/me/claims/${claim.id}`);
}

/** 撤回自己发起的认领申请 */
export async function cancelClaimAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const claimId = text(formData, "claimId");

  const claim = await getClaimById(claimId);
  if (!claim || claim.claimantId !== user.id || claim.status !== "PENDING") return;

  await prisma.claim.update({
    where: { id: claim.id },
    data: { status: "CANCELLED" },
  });

  revalidateClaim(claim.id, claim.post.id);
  redirect("/me/claims");
}

/**
 * 审核认领（P3）：原子状态变更交给数据库函数 fn_review_claim。
 * 函数内部用行锁完成权限校验、帖子状态占用、同帖其它申请自动拒绝与交接记录创建；
 * 应用层只负责发送通知与刷新页面。
 */
export async function reviewClaimAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const claimId = text(formData, "claimId");
  const decision = text(formData, "decision");
  const note = text(formData, "note");

  const rows = await prisma.$queryRaw<Array<{ result: Prisma.JsonValue }>>`
    SELECT fn_review_claim(
      ${claimId}::text,
      ${user.id}::text,
      ${decision}::text,
      ${note || null}::text
    ) AS result
  `;
  const result = parseJson<ClaimReviewResult>(rows[0]?.result);
  if (!result?.ok) return;

  const postId = result.postId;
  const postTitle = result.postTitle ?? "";

  if (result.status === "REJECTED") {
    if (result.claimantId) {
      await notify({
        userId: result.claimantId,
        type: "CLAIM_RESULT",
        title: "认领申请未通过",
        body: `你对《${postTitle}》的认领申请未通过。${note ? `备注：${note}` : ""}`,
        link: `/me/claims/${claimId}`,
      });
    }

    revalidateClaim(claimId, postId);
    revalidatePath("/me");
    return;
  }

  if (result.status === "ACCEPTED") {
    if (result.claimantId) {
      await notify({
        userId: result.claimantId,
        type: "CLAIM_RESULT",
        title: "认领申请已通过",
        body: `你对《${postTitle}》的认领申请已通过，可以开始约定线下交接。`,
        link: `/me/claims/${claimId}`,
      });
    }

    // 同帖其他待审申请已被函数自动拒绝，逐一通知申请人
    for (const item of result.rejectedClaims ?? []) {
      await notify({
        userId: item.claimantId,
        type: "CLAIM_RESULT",
        title: "认领申请未通过",
        body: `《${postTitle}》已被其他申请人认领。`,
        link: `/me/claims/${item.claimId}`,
      });
    }

    revalidateClaim(claimId, postId);
    revalidatePath("/me");
  }
}

/** 发起或修改线下交接安排（CLFP-USR-0012） */
export async function proposeHandoverAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const claimId = text(formData, "claimId");

  const claim = await getClaimById(claimId);
  if (!claim || claim.status !== "ACCEPTED" || !isClaimParty(claim, user.id)) return;

  const parsed = handoverSchema.safeParse({
    meetAt: text(formData, "meetAt"),
    meetPlace: text(formData, "meetPlace"),
  });
  if (!parsed.success) return;

  const { date } = parseMeetAt(parsed.data.meetAt);
  if (!date) return;

  await prisma.handover.upsert({
    where: { claimId: claim.id },
    update: {
      meetAt: date,
      meetPlace: parsed.data.meetPlace,
      proposedById: user.id,
      proposedAt: new Date(),
    },
    create: {
      claimId: claim.id,
      meetAt: date,
      meetPlace: parsed.data.meetPlace,
      proposedById: user.id,
      proposedAt: new Date(),
    },
  });

  const otherId = claim.claimantId === user.id ? claim.post.authorId : claim.claimantId;
  await notify({
    userId: otherId,
    type: "HANDOVER",
    title: "对方提交了线下交接安排",
    body: `《${claim.post.title}》的交接安排已更新，请查看并确认。`,
    link: `/me/claims/${claim.id}`,
  });

  revalidateClaim(claim.id, claim.post.id);
}

/** 确认交接完成：任一方确认即生效 */
export async function completeHandoverAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const claimId = text(formData, "claimId");

  const claim = await getClaimById(claimId);
  if (!claim || claim.status !== "ACCEPTED" || !isClaimParty(claim, user.id)) return;
  if (claim.handover?.completedAt) return;

  const rows = await prisma.$queryRaw<Array<{ result: Prisma.JsonValue }>>`
    SELECT fn_complete_handover(${claim.id}::text, ${user.id}::text) AS result
  `;
  const result = parseJson<HandoverResult>(rows[0]?.result);
  if (!result?.ok) return;

  const otherId = claim.claimantId === user.id ? claim.post.authorId : claim.claimantId;
  await notify({
    userId: otherId,
    type: "HANDOVER",
    title: "交接已确认完成",
    body: `《${claim.post.title}》的交接已由对方确认完成。`,
    link: `/me/claims/${claim.id}`,
  });

  revalidateClaim(claim.id, claim.post.id);
  revalidatePath("/me");
}

/** 授权 / 撤回「向对方展示我的联系方式」（CLFP-USR-0014） */
export async function toggleContactGrantAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const claimId = text(formData, "claimId");
  const action = text(formData, "action");

  const claim = await getClaimById(claimId);
  if (!claim || claim.status !== "ACCEPTED" || !isClaimParty(claim, user.id)) return;

  const granteeId = claim.claimantId === user.id ? claim.post.authorId : claim.claimantId;

  await prisma.contactGrant.upsert({
    where: { claimId_grantorId: { claimId: claim.id, grantorId: user.id } },
    update: { revokedAt: action === "grant" ? null : new Date(), granteeId },
    create: { claimId: claim.id, grantorId: user.id, granteeId },
  });

  revalidateClaim(claim.id, claim.post.id);
}
