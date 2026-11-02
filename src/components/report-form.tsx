"use client";

import { useActionState, useState } from "react";
import { Alert, SubmitButton } from "@/components/ui";
import { emptyFormState, type FormState } from "@/lib/form-state";
import { REPORT_REASONS } from "@/lib/reports";
import { createReportAction } from "@/server/report-actions";

/** 举报表单（CLFP-USR-0015） */
export function ReportForm({ postId }: { postId: string }) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(
    createReportAction,
    emptyFormState,
  );
  const [reason, setReason] = useState<string>(REPORT_REASONS[0]);

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="postId" value={postId} />
      {state.error ? <Alert>{state.error}</Alert> : null}

      <fieldset>
        <legend className="mb-2 text-sm font-medium text-slate-700">
          举报类型<span className="ml-0.5 text-red-500">*</span>
        </legend>
        <div className="flex flex-wrap gap-2">
          {REPORT_REASONS.map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => setReason(item)}
              className={`rounded-lg border px-3 py-1.5 text-sm transition ${
                reason === item
                  ? "border-sky-500 bg-sky-50 text-sky-700"
                  : "border-slate-300 bg-white text-slate-600 hover:bg-slate-50"
              }`}
            >
              {item}
            </button>
          ))}
        </div>
        <input type="hidden" name="reason" value={reason} />
        {state.fieldErrors?.reason ? (
          <span className="mt-1 block text-xs text-red-600">{state.fieldErrors.reason}</span>
        ) : null}
      </fieldset>

      <label className="block">
        <span className="mb-1 block text-sm font-medium text-slate-700">补充说明（可选）</span>
        <textarea
          name="detail"
          rows={4}
          placeholder="请说明举报理由，例如为什么判断信息不实、重复或涉嫌诈骗"
          className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-100"
        />
        {state.fieldErrors?.detail ? (
          <span className="mt-1 block text-xs text-red-600">{state.fieldErrors.detail}</span>
        ) : null}
      </label>

      <SubmitButton pending={pending}>提交举报</SubmitButton>
    </form>
  );
}
