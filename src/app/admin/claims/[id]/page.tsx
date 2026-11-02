import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Card } from "@/components/ui";
import { CLAIM_STATUS_LABEL, CLAIM_STATUS_STYLE, canReviewClaim, escalateOverdueClaims, getClaimById } from "@/lib/claims";
import { POST_TYPE_LABEL } from "@/lib/constants";
import { formatDateTime } from "@/lib/datetime";
import { requireAdmin } from "@/lib/session";
import { reviewClaimAction } from "@/server/claim-actions";

export const metadata: Metadata = { title: "认领审核 · 校园失物招领平台" };

export default async function AdminClaimDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin();
  const { id } = await params;
  await escalateOverdueClaims();
  const claim = await getClaimById(id);
  if (!claim) notFound();

  const canReview = canReviewClaim(claim, admin);
  const canAccept = claim.post.status === "OPEN" && !claim.post.deletedAt && !claim.post.takenDownAt;

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <Link href="/admin/claims" className="inline-block text-sm text-sky-700 hover:underline">← 返回认领处理</Link>
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="section-heading text-xl font-bold">认领审核</h2>
        <span className={`rounded px-2 py-1 text-xs ${CLAIM_STATUS_STYLE[claim.status]}`}>
          {CLAIM_STATUS_LABEL[claim.status]}
        </span>
        {claim.status === "PENDING" ? (
          <span className="rounded bg-amber-100 px-2 py-1 text-xs text-amber-800">
            {claim.escalatedAt ? "已转交管理员" : "待发布者处理"}
          </span>
        ) : null}
      </div>

      <Card title="对应的信息">
        <p className="text-sm text-slate-800">
          <span className="mr-2 rounded bg-teal-50 px-2 py-0.5 text-xs text-teal-700">{POST_TYPE_LABEL[claim.post.type]}</span>
          <Link href={`/posts/${claim.post.id}`} className="font-semibold text-sky-700 hover:underline">{claim.post.title}</Link>
        </p>
        <p className="mt-2 text-sm text-slate-600">发布者：{claim.post.author.nickname} · 申请人：{claim.claimant.nickname}{claim.claimant.department ? `（${claim.claimant.department}）` : ""}</p>
        <p className="mt-1 text-xs text-slate-500">申请时间：{formatDateTime(claim.createdAt)} · 作者处理截止：{formatDateTime(claim.escalateAt)}</p>
        {claim.escalatedAt ? <p className="mt-1 text-xs text-amber-800">转交时间：{formatDateTime(claim.escalatedAt)}</p> : null}
        {!canAccept ? <p className="mt-2 text-xs text-red-700">对应信息已结束或不可公开，仅可拒绝这条待审申请。</p> : null}
      </Card>

      <Card title="申请内容与凭证">
        <dl className="space-y-3 text-sm">
          <div><dt className="text-slate-500">认领说明</dt><dd className="mt-1 whitespace-pre-wrap text-slate-800">{claim.message}</dd></div>
          <div><dt className="text-slate-500">认领凭证</dt><dd className="mt-1 whitespace-pre-wrap text-slate-800">{claim.proof}</dd></div>
          <div><dt className="text-slate-500">申请人联系方式（脱敏）</dt><dd className="mt-1 text-slate-800">{claim.contactMasked}</dd></div>
        </dl>
      </Card>

      {canReview ? (
        <Card title="处理申请" description="核对凭证后作出决定。通过后信息会标记为已解决，同帖其他待审申请会被拒绝。">
          <div className="grid gap-4 sm:grid-cols-2">
            {canAccept ? (
              <form action={reviewClaimAction} className="space-y-2">
                <input type="hidden" name="claimId" value={claim.id} />
                <input type="hidden" name="decision" value="ACCEPT" />
                <textarea name="note" rows={2} maxLength={500} placeholder="处理备注（可选）" className="w-full rounded-lg border-2 border-[#d7c8ad] bg-[#fffefa] px-3 py-2 text-sm outline-none" />
                <button type="submit" className="w-full rounded-lg border-2 border-emerald-700 bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:-translate-y-0.5 hover:bg-emerald-700">通过认领</button>
              </form>
            ) : null}
            <form action={reviewClaimAction} className="space-y-2">
              <input type="hidden" name="claimId" value={claim.id} />
              <input type="hidden" name="decision" value="REJECT" />
              <textarea name="note" rows={2} maxLength={500} placeholder="拒绝理由（可选，会展示给申请人）" className="w-full rounded-lg border-2 border-[#d7c8ad] bg-[#fffefa] px-3 py-2 text-sm outline-none" />
              <button type="submit" className="w-full rounded-lg border-2 border-red-300 bg-red-50 px-4 py-2 text-sm font-semibold text-red-700 hover:-translate-y-0.5 hover:bg-red-100">拒绝申请</button>
            </form>
          </div>
        </Card>
      ) : claim.status === "PENDING" ? (
        <p className="paper-panel p-4 text-sm text-slate-600">申请仍在发布者的处理期限内，超时后才会进入管理员待办。</p>
      ) : (
        <Card title="处理结果">
          <p className="text-sm text-slate-700">
            {CLAIM_STATUS_LABEL[claim.status]}
            {claim.reviewedBy ? ` · 由 ${claim.reviewedBy.nickname}` : ""}
            {claim.reviewerRole === "ADMIN" ? "（管理员）" : claim.reviewerRole === "OWNER" ? "（发布者）" : ""}
            {claim.reviewedAt ? ` · ${formatDateTime(claim.reviewedAt)}` : ""}
          </p>
          {claim.reviewNote ? <p className="mt-2 whitespace-pre-wrap text-sm text-slate-600">备注：{claim.reviewNote}</p> : null}
        </Card>
      )}
    </div>
  );
}
