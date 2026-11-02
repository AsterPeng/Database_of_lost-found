import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Card } from "@/components/ui";
import { POST_TYPE_LABEL } from "@/lib/constants";
import {
  CLAIM_STATUS_LABEL,
  CLAIM_STATUS_STYLE,
  canReviewClaim,
  escalateOverdueClaims,
  getClaimById,
  getContactVisibility,
  isClaimParty,
} from "@/lib/claims";
import { decryptField } from "@/lib/crypto";
import { formatDateTime, formatRelative } from "@/lib/datetime";
import { toLocalDateTimeInput } from "@/lib/datetime";
import { requireUser } from "@/lib/session";
import {
  cancelClaimAction,
  completeHandoverAction,
  proposeHandoverAction,
  reviewClaimAction,
  toggleContactGrantAction,
} from "@/server/claim-actions";

export const metadata: Metadata = { title: "认领详情 · 校园失物招领平台" };

const inputClass =
  "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-100";

export default async function ClaimDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();

  await escalateOverdueClaims();

  const claim = await getClaimById(id);
  if (!claim) notFound();

  const isParty = isClaimParty(claim, user.id);
  if (!isParty && user.role !== "ADMIN") notFound();
  if (!isParty) redirect(`/admin/claims/${claim.id}`);

  const viewerIsClaimant = claim.claimantId === user.id;
  const canReview = canReviewClaim(claim, user);
  const contact = await getContactVisibility(claim, user.id);
  const escalated = claim.status === "PENDING" && claim.escalatedAt !== null;

  // 认领人查看自己提交的联系方式时直接解密展示
  const mySubmittedContact = viewerIsClaimant ? decryptField(claim.contactEncrypted) : null;

  const otherPartyLabel = viewerIsClaimant
    ? `发布者 ${claim.post.author.nickname}`
    : `申请人 ${claim.claimant.nickname}`;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <Link href="/me/claims" className="inline-block text-sm text-slate-500 hover:text-sky-700">
        ← 返回我的认领
      </Link>

      <div className="flex flex-wrap items-center gap-2">
        <span className={`rounded px-2 py-0.5 text-xs ${CLAIM_STATUS_STYLE[claim.status]}`}>
          {CLAIM_STATUS_LABEL[claim.status]}
        </span>
        {escalated ? (
          <span className="rounded bg-purple-50 px-2 py-0.5 text-xs text-purple-700">
            已转交管理员（作者 48 小时未处理）
          </span>
        ) : null}
        {claim.status === "PENDING" && !escalated ? (
          <span className="text-xs text-slate-500">
            作者处理截止：{formatDateTime(claim.escalateAt)}
          </span>
        ) : null}
      </div>

      <Card title="对应的信息">
        <p className="flex flex-wrap items-center gap-2">
          <span
            className={`rounded px-1.5 py-0.5 text-xs ${
              claim.post.type === "LOST" ? "bg-amber-50 text-amber-700" : "bg-teal-50 text-teal-700"
            }`}
          >
            {POST_TYPE_LABEL[claim.post.type]}
          </span>
          <Link href={`/posts/${claim.post.id}`} className="text-sm font-medium text-sky-700 hover:underline">
            {claim.post.title}
          </Link>
        </p>
        <p className="mt-2 text-sm text-slate-500">{otherPartyLabel}</p>
      </Card>

      <Card title="认领内容">
        <dl className="space-y-3 text-sm">
          <div>
            <dt className="text-slate-500">认领说明</dt>
            <dd className="mt-0.5 whitespace-pre-wrap text-slate-800">{claim.message}</dd>
          </div>
          <div>
            <dt className="text-slate-500">认领凭证</dt>
            <dd className="mt-0.5 whitespace-pre-wrap text-slate-800">{claim.proof}</dd>
          </div>
          {viewerIsClaimant ? (
            <div>
              <dt className="text-slate-500">我提交的联系方式</dt>
              <dd className="mt-0.5 text-slate-800">{mySubmittedContact ?? claim.contactMasked}</dd>
            </div>
          ) : null}
          <div>
            <dt className="text-slate-500">提交时间</dt>
            <dd className="mt-0.5 text-slate-800">{formatDateTime(claim.createdAt)}</dd>
          </div>
        </dl>
      </Card>

      {canReview ? (
        <Card
          title="审核认领申请"
          description="请根据对方提供的凭证判断物品归属；通过后该信息将标记为已解决。"
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <form action={reviewClaimAction} className="space-y-3">
              <input type="hidden" name="claimId" value={claim.id} />
              <input type="hidden" name="decision" value="ACCEPT" />
              <textarea
                name="note"
                rows={2}
                placeholder="备注（可选）"
                className={inputClass}
              />
              <button
                type="submit"
                className="w-full rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700"
              >
                通过认领
              </button>
            </form>

            <form action={reviewClaimAction} className="space-y-3">
              <input type="hidden" name="claimId" value={claim.id} />
              <input type="hidden" name="decision" value="REJECT" />
              <textarea
                name="note"
                rows={2}
                placeholder="拒绝理由（可选，会展示给申请人）"
                className={inputClass}
              />
              <button
                type="submit"
                className="w-full rounded-lg border border-red-200 px-4 py-2 text-sm font-medium text-red-600 hover:bg-red-50"
              >
                拒绝申请
              </button>
            </form>
          </div>
        </Card>
      ) : null}

      {claim.status !== "PENDING" ? (
        <Card title="审核结果">
          <p className="text-sm text-slate-700">
            {CLAIM_STATUS_LABEL[claim.status]}
            {claim.reviewedBy ? ` · 由 ${claim.reviewedBy.nickname}` : ""}
            {claim.reviewerRole === "ADMIN" ? "（管理员）" : claim.reviewerRole === "OWNER" ? "（信息发布者）" : ""}
            {claim.reviewedAt ? ` 于 ${formatDateTime(claim.reviewedAt)}` : ""}
          </p>
          {claim.reviewNote ? (
            <p className="mt-2 rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-600">
              备注：{claim.reviewNote}
            </p>
          ) : null}
        </Card>
      ) : null}

      {viewerIsClaimant && claim.status === "PENDING" ? (
        <form action={cancelClaimAction}>
          <input type="hidden" name="claimId" value={claim.id} />
          <button
            type="submit"
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50"
          >
            撤回申请
          </button>
        </form>
      ) : null}

      {claim.status === "ACCEPTED" ? (
        <>
          <Card title="线下交接" description="双方约定时间地点，完成交接后由任一方确认即可。">
            {claim.handover?.completedAt ? (
              <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-3 text-sm text-emerald-800">
                交接已于 {formatDateTime(claim.handover.completedAt)} 完成
                （由{claim.handover.completedById === user.id ? "你" : "对方"}确认）
              </div>
            ) : (
              <div className="space-y-4">
                {claim.handover?.meetAt ? (
                  <div className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-700">
                    当前安排：{formatDateTime(claim.handover.meetAt)} · {claim.handover.meetPlace}
                    {claim.handover.proposedById === user.id ? "（由你提议）" : "（由对方提议）"}
                  </div>
                ) : (
                  <p className="text-sm text-slate-500">还没有确定交接安排。</p>
                )}

                <form action={proposeHandoverAction} className="space-y-3">
                  <input type="hidden" name="claimId" value={claim.id} />
                  <div className="grid gap-3 sm:grid-cols-2">
                    <label className="block">
                      <span className="mb-1 block text-xs text-slate-500">交接时间</span>
                      <input
                        type="datetime-local"
                        name="meetAt"
                        required
                        defaultValue={
                          claim.handover?.meetAt ? toLocalDateTimeInput(claim.handover.meetAt) : undefined
                        }
                        className={inputClass}
                      />
                    </label>
                    <label className="block">
                      <span className="mb-1 block text-xs text-slate-500">交接地点</span>
                      <input
                        type="text"
                        name="meetPlace"
                        required
                        defaultValue={claim.handover?.meetPlace ?? ""}
                        placeholder="例如：图书馆一楼大厅"
                        className={inputClass}
                      />
                    </label>
                  </div>
                  <button
                    type="submit"
                    className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-medium text-white hover:bg-sky-700"
                  >
                    {claim.handover?.meetAt ? "更新交接安排" : "提交交接安排"}
                  </button>
                </form>

                {claim.handover?.meetAt ? (
                  <form action={completeHandoverAction}>
                    <input type="hidden" name="claimId" value={claim.id} />
                    <button
                      type="submit"
                      className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700"
                    >
                      确认交接完成
                    </button>
                  </form>
                ) : null}
              </div>
            )}
          </Card>

          <Card
            title="联系方式"
            description="默认只显示脱敏结果；只有对方本人主动授权后，你才能看到完整联系方式（CLFP-USR-0014）。"
          >
            <p className="text-sm text-slate-700">
              对方联系方式：
              {contact.canSeeOther && contact.otherContact ? (
                <span className="ml-1 font-medium text-emerald-700">{contact.otherContact}</span>
              ) : (
                <span className="ml-1 text-slate-500">
                  {contact.otherMasked}
                  <span className="ml-2 text-xs text-slate-400">（对方尚未授权展示）</span>
                </span>
              )}
            </p>

            <form action={toggleContactGrantAction} className="mt-4">
              <input type="hidden" name="claimId" value={claim.id} />
              <input type="hidden" name="action" value={contact.iHaveGranted ? "revoke" : "grant"} />
              <button
                type="submit"
                className={
                  contact.iHaveGranted
                    ? "rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50"
                    : "rounded-lg bg-sky-600 px-4 py-2 text-sm font-medium text-white hover:bg-sky-700"
                }
              >
                {contact.iHaveGranted ? "撤回我的联系方式授权" : "向对方展示我的联系方式"}
              </button>
            </form>

            <p className="mt-2 text-xs text-slate-500">
              {contact.iHaveGranted
                ? "你已授权对方查看你的联系方式。"
                : "你还没有授权对方查看你的联系方式。"}
              当前状态：
              {contact.canSeeOther ? "双方均可查看对方联系方式" : "未完全互相授权"}
            </p>
          </Card>
        </>
      ) : null}

      <p className="text-xs text-slate-400">
        申请提交于 {formatRelative(claim.createdAt)}；请优先在校园内公共场所交接，注意个人安全。
      </p>
    </div>
  );
}
