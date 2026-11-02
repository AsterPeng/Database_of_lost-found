"use client";

import { useActionState } from "react";
import { Alert, Field, SubmitButton } from "@/components/ui";
import { emptyFormState, type FormState } from "@/lib/form-state";
import { createClaimAction } from "@/server/claim-actions";

const textareaClass =
  "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-sky-500 focus:ring-2 focus:ring-sky-100";

/** 认领申请表单（CLFP-USR-0011） */
export function ClaimForm({ postId }: { postId: string }) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(
    createClaimAction,
    emptyFormState,
  );

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="postId" value={postId} />
      {state.error ? <Alert>{state.error}</Alert> : null}

      <label className="block">
        <span className="mb-1 block text-sm font-medium text-slate-700">
          认领说明<span className="ml-0.5 text-red-500">*</span>
        </span>
        <textarea
          name="message"
          rows={3}
          required
          placeholder="说明这件物品为什么是你的，例如丢失的时间地点与经过"
          className={textareaClass}
        />
        {state.fieldErrors?.message ? (
          <span className="mt-1 block text-xs text-red-600">{state.fieldErrors.message}</span>
        ) : null}
      </label>

      <label className="block">
        <span className="mb-1 block text-sm font-medium text-slate-700">
          认领凭证<span className="ml-0.5 text-red-500">*</span>
        </span>
        <textarea
          name="proof"
          rows={3}
          required
          placeholder="只有真正的主人才知道的细节，例如物品上的划痕、贴纸位置、壁纸、锁屏、内含物品等"
          className={textareaClass}
        />
        <span className="mt-1 block text-xs text-slate-500">
          凭证越具体，越容易通过审核；请不要填写无关的个人隐私。
        </span>
        {state.fieldErrors?.proof ? (
          <span className="mt-1 block text-xs text-red-600">{state.fieldErrors.proof}</span>
        ) : null}
      </label>

      <Field
        label="你的联系方式"
        name="contact"
        required
        placeholder="手机号或微信号"
        hint="加密存储，默认只对审核人脱敏展示；双方都授权后才会互相可见"
        error={state.fieldErrors?.contact}
      />

      <SubmitButton pending={pending}>提交认领申请</SubmitButton>
    </form>
  );
}
