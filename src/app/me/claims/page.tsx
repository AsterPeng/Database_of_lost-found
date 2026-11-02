import type { Metadata } from "next";
import Link from "next/link";
import {
  CLAIM_STATUS_LABEL,
  CLAIM_STATUS_STYLE,
  escalateOverdueClaims,
  listClaimsForUser,
  type ClaimWithRelations,
} from "@/lib/claims";
import { formatRelative } from "@/lib/datetime";
import { requireUser } from "@/lib/session";

export const metadata: Metadata = { title: "我的认领 · 校园失物招领平台" };

function ClaimRow({ claim, role }: { claim: ClaimWithRelations; role: "mine" | "received" }) {
  const escalated = claim.status === "PENDING" && claim.escalatedAt !== null;

  return (
    <li>
      <Link
        href={`/me/claims/${claim.id}`}
        className="block rounded-xl border border-slate-200 bg-white p-4 transition hover:border-sky-300"
      >
        <div className="flex flex-wrap items-center gap-2">
          <span className={`rounded px-2 py-0.5 text-xs ${CLAIM_STATUS_STYLE[claim.status]}`}>
            {CLAIM_STATUS_LABEL[claim.status]}
          </span>
          {escalated ? (
            <span className="rounded bg-purple-50 px-2 py-0.5 text-xs text-purple-700">
              已转交管理员
            </span>
          ) : null}
          <span className="text-xs text-slate-400">{formatRelative(claim.createdAt)}</span>
        </div>

        <p className="mt-2 text-sm font-medium text-slate-900">{claim.post.title}</p>
        <p className="mt-0.5 text-xs text-slate-500">
          {role === "mine"
            ? `发布者 ${claim.post.author.nickname}`
            : `申请人 ${claim.claimant.nickname}`}
          {role === "received" && claim.claimant.department
            ? ` · ${claim.claimant.department}`
            : ""}
        </p>
        <p className="mt-1 line-clamp-2 text-xs text-slate-500">{claim.message}</p>
      </Link>
    </li>
  );
}

/** 我的认领：我发起的 + 我收到的（CLFP-USR-0011、0018） */
export default async function MyClaimsPage() {
  const user = await requireUser();

  // 每次进入页面时顺手处理超时未审核的申请，无需额外的定时任务
  await escalateOverdueClaims();

  const { mine, received } = await listClaimsForUser(user.id);
  const pendingReceived = received.filter((claim) => claim.status === "PENDING").length;
  const accepted = [...mine, ...received].filter((claim) => claim.status === "ACCEPTED").length;

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">我的认领</h1>
        <p className="mt-1 text-sm text-slate-500">
          认领申请由信息发布者先审核；若 48 小时内未处理，会自动转交管理员。
        </p>
      </div>

      <div className="grid grid-cols-3 gap-3">
        {[
          { label: "我发起的", value: mine.length },
          { label: "待我处理", value: pendingReceived },
          { label: "已通过", value: accepted },
        ].map((item) => (
          <div key={item.label} className="rounded-xl border border-slate-200 bg-white p-4">
            <p className="text-xs text-slate-500">{item.label}</p>
            <p className="mt-1 text-2xl font-semibold text-slate-900">{item.value}</p>
          </div>
        ))}
      </div>

      <section className="space-y-3">
        <div className="flex items-baseline justify-between">
          <h2 className="text-base font-semibold text-slate-900">收到的认领申请</h2>
          <span className="text-xs text-slate-500">共 {received.length} 条</span>
        </div>
        {received.length === 0 ? (
          <p className="rounded-xl border border-dashed border-slate-300 bg-white p-6 text-center text-sm text-slate-500">
            还没有人申请认领你发布的信息。
          </p>
        ) : (
          <ul className="space-y-3">
            {received.map((claim) => (
              <ClaimRow key={claim.id} claim={claim} role="received" />
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-3">
        <div className="flex items-baseline justify-between">
          <h2 className="text-base font-semibold text-slate-900">我发起的认领</h2>
          <span className="text-xs text-slate-500">共 {mine.length} 条</span>
        </div>
        {mine.length === 0 ? (
          <p className="rounded-xl border border-dashed border-slate-300 bg-white p-6 text-center text-sm text-slate-500">
            你还没有发起过认领。在信息详情页可以提交认领申请。
          </p>
        ) : (
          <ul className="space-y-3">
            {mine.map((claim) => (
              <ClaimRow key={claim.id} claim={claim} role="mine" />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
