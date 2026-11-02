/**
 * 认领相关的查询与规则（CLFP-USR-0011、0012、0014）。
 */
import type { Prisma, User } from "@prisma/client";
import { decryptField } from "./crypto";
import { prisma } from "./db";
import { notifyAdmins } from "./notifications";

/** 作者超过该时长未处理，认领申请自动转交管理员 */
export const ESCALATE_HOURS = 48;

type EscalatedClaim = {
  claimId: string;
  postId: string;
  postTitle: string;
  claimantId: string;
};

type EscalateResult = {
  count?: number;
  claims?: EscalatedClaim[];
};

/**
 * 把超时未处理的待审申请标记为「已转交管理员」，并通知管理员。
 * P3：批量标记与行锁交给数据库函数 fn_escalate_overdue_claims；
 * 应用层根据返回的认领列表发送通知，保持原有文案与免打扰逻辑。
 */
export async function escalateOverdueClaims(): Promise<number> {
  const rows = await prisma.$queryRaw<Array<{ result: Prisma.JsonValue }>>`
    SELECT fn_escalate_overdue_claims() AS result
  `;
  const raw = rows[0]?.result;
  if (raw === undefined || raw === null) return 0;

  const payload = (typeof raw === "string" ? JSON.parse(raw) : raw) as EscalateResult;
  const claims = payload.claims ?? [];
  if (claims.length === 0) return Number(payload.count ?? 0);

  const nicknames = new Map(
    (
      await prisma.user.findMany({
        where: { id: { in: claims.map((claim) => claim.claimantId) } },
        select: { id: true, nickname: true },
      })
    ).map((user) => [user.id, user.nickname]),
  );

  for (const claim of claims) {
    await notifyAdmins({
      type: "CLAIM_ESCALATED",
      title: "有认领申请超时未处理",
      body: `《${claim.postTitle}》的认领申请已超过 ${ESCALATE_HOURS} 小时未被发布者处理（申请人 ${nicknames.get(claim.claimantId) ?? "同学"}），请及时审核。`,
      link: `/admin/claims/${claim.claimId}`,
    });
  }

  return Number(payload.count ?? claims.length);
}

export const claimInclude = {
  post: {
    select: {
      id: true,
      title: true,
      type: true,
      authorId: true,
      status: true,
      deletedAt: true,
      takenDownAt: true,
      author: { select: { nickname: true } },
    },
  },
  claimant: { select: { id: true, nickname: true, department: true } },
  reviewedBy: { select: { id: true, nickname: true } },
  handover: true,
} satisfies Prisma.ClaimInclude;

export type ClaimWithRelations = Prisma.ClaimGetPayload<{ include: typeof claimInclude }>;

/** 我发起的认领 + 我收到的认领（CLFP-USR-0018） */
export async function listClaimsForUser(userId: string) {
  const [mine, received] = await Promise.all([
    prisma.claim.findMany({
      where: { claimantId: userId },
      orderBy: { createdAt: "desc" },
      include: claimInclude,
    }),
    prisma.claim.findMany({
      where: { post: { authorId: userId } },
      orderBy: { createdAt: "desc" },
      include: claimInclude,
    }),
  ]);
  return { mine, received };
}

export async function getClaimById(claimId: string): Promise<ClaimWithRelations | null> {
  return prisma.claim.findUnique({ where: { id: claimId }, include: claimInclude });
}

/** 是否是这条认领的当事双方之一 */
export function isClaimParty(claim: ClaimWithRelations, userId: string): boolean {
  return claim.claimantId === userId || claim.post.authorId === userId;
}

/** 作者可先审；管理员只接手已经超时转交的申请。 */
export function canReviewClaim(claim: ClaimWithRelations, user: Pick<User, "id" | "role">): boolean {
  if (claim.status !== "PENDING") return false;
  return claim.post.authorId === user.id || (user.role === "ADMIN" && claim.escalatedAt !== null);
}

export type ContactVisibility = {
  /** 对方是否已授权我查看他/她的联系方式 */
  canSeeOther: boolean;
  /** 我是否已经授权对方查看我的联系方式 */
  iHaveGranted: boolean;
  /** 可见时的完整联系方式 */
  otherContact: string | null;
  /** 不可见时展示的脱敏值 */
  otherMasked: string;
};

/**
 * 联系方式可见性（CLFP-USR-0014）：
 * 只有认领通过、且对方本人主动授权后，才能看到完整联系方式；否则只能看到脱敏值。
 */
export async function getContactVisibility(
  claim: ClaimWithRelations,
  viewerId: string,
): Promise<ContactVisibility> {
  const viewerIsClaimant = claim.claimantId === viewerId;
  const otherId = viewerIsClaimant ? claim.post.authorId : claim.claimantId;

  const [otherGrant, myGrant, otherUser] = await Promise.all([
    prisma.contactGrant.findUnique({
      where: { claimId_grantorId: { claimId: claim.id, grantorId: otherId } },
    }),
    prisma.contactGrant.findUnique({
      where: { claimId_grantorId: { claimId: claim.id, grantorId: viewerId } },
    }),
    prisma.user.findUnique({
      where: { id: otherId },
      select: { phoneEncrypted: true, phoneMasked: true, nickname: true, department: true },
    }),
  ]);

  const accepted = claim.status === "ACCEPTED";
  const canSeeOther = accepted && Boolean(otherGrant && !otherGrant.revokedAt);
  const iHaveGranted = Boolean(myGrant && !myGrant.revokedAt);

  let otherContact: string | null = null;
  if (canSeeOther) {
    // 对方是认领人时，联系方式存在认领记录里；对方是作者时，取自其账号资料
    otherContact = viewerIsClaimant
      ? (otherUser?.phoneEncrypted ? decryptField(otherUser.phoneEncrypted) : null)
      : decryptField(claim.contactEncrypted);
  }

  const otherMasked = viewerIsClaimant
    ? (otherUser?.phoneMasked ?? "未填写")
    : claim.contactMasked;

  return { canSeeOther, iHaveGranted, otherContact, otherMasked };
}

/** 待审申请是否已经超时转交管理员 */
export function isEscalated(claim: ClaimWithRelations): boolean {
  return claim.status === "PENDING" && claim.escalatedAt !== null;
}

export const CLAIM_STATUS_LABEL = {
  PENDING: "待处理",
  ACCEPTED: "已通过",
  REJECTED: "已拒绝",
  CANCELLED: "已撤回",
} as const;

export const CLAIM_STATUS_STYLE = {
  PENDING: "bg-amber-50 text-amber-700",
  ACCEPTED: "bg-emerald-50 text-emerald-700",
  REJECTED: "bg-red-50 text-red-600",
  CANCELLED: "bg-slate-100 text-slate-500",
} as const;
