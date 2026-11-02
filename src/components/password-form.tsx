"use client";

import { useActionState } from "react";
import { Alert, Field, SubmitButton } from "@/components/ui";
import { emptyFormState } from "@/lib/form-state";
import { changePasswordAction } from "@/server/auth-actions";

export function PasswordForm() {
  const [state, formAction, pending] = useActionState(changePasswordAction, emptyFormState);

  return (
    <form action={formAction} className="space-y-4">
      {state.error ? <Alert>{state.error}</Alert> : null}
      {state.success ? <Alert tone="success">{state.success}</Alert> : null}

      <Field
        label="当前密码"
        name="currentPassword"
        type="password"
        required
        autoComplete="current-password"
        error={state.fieldErrors?.currentPassword}
      />
      <Field
        label="新密码"
        name="newPassword"
        type="password"
        required
        autoComplete="new-password"
        hint="至少 8 位"
        error={state.fieldErrors?.newPassword}
      />
      <Field
        label="确认新密码"
        name="confirmPassword"
        type="password"
        required
        autoComplete="new-password"
        error={state.fieldErrors?.confirmPassword}
      />

      <SubmitButton pending={pending}>修改密码</SubmitButton>
    </form>
  );
}
