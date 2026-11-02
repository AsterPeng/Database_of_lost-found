"use client";

import { useActionState } from "react";
import { Alert, Field, SubmitButton } from "@/components/ui";
import { emptyFormState, type FormState } from "@/lib/form-state";
import { createAnnouncementAction } from "@/server/announcement-actions";

/** 发布公告表单（CLFP-USR-0024） */
export function AnnouncementForm() {
  const [state, formAction, pending] = useActionState<FormState, FormData>(
    createAnnouncementAction,
    emptyFormState,
  );

  return (
    <form action={formAction} className="space-y-4">
      {state.error ? <Alert>{state.error}</Alert> : null}
      {state.success ? <Alert tone="success">{state.success}</Alert> : null}

      <Field
        label="公告标题"
        name="title"
        required
        placeholder="例如：失物招领处开放时间调整"
        error={state.fieldErrors?.title}
      />

      <label className="block">
        <span className="mb-1 block text-sm font-medium text-slate-700">
          公告内容<span className="ml-0.5 text-red-500">*</span>
        </span>
        <textarea
          name="body"
          rows={4}
          required
          placeholder="公告正文，会展示在首页"
          className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-100"
        />
        {state.fieldErrors?.body ? (
          <span className="mt-1 block text-xs text-red-600">{state.fieldErrors.body}</span>
        ) : null}
      </label>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label="过期时间（可选）"
          name="expiresAt"
          type="datetime-local"
          hint="留空表示长期有效"
        />
        <label className="flex items-center gap-2 self-end pb-2 text-sm text-slate-700">
          <input type="checkbox" name="pinned" className="h-4 w-4 rounded border-slate-300" />
          置顶显示
        </label>
      </div>

      <SubmitButton pending={pending}>发布公告</SubmitButton>
    </form>
  );
}
