"use client";

import Link from "next/link";
import { useActionState } from "react";
import { Alert, Field, SubmitButton } from "@/components/ui";
import { emptyFormState } from "@/lib/form-state";
import { loginAction } from "@/server/auth-actions";

export function LoginForm() {
  const [state, formAction, pending] = useActionState(loginAction, emptyFormState);

  return (
    <form action={formAction} className="space-y-4">
      {state.error ? <Alert>{state.error}</Alert> : null}

      <Field
        label="邮箱"
        name="email"
        type="email"
        required
        autoComplete="email"
        placeholder="you@example.com"
        error={state.fieldErrors?.email}
      />
      <Field
        label="密码"
        name="password"
        type="password"
        required
        autoComplete="current-password"
        error={state.fieldErrors?.password}
      />

      <SubmitButton pending={pending}>登录</SubmitButton>

      <p className="text-center text-sm text-slate-500">
        还没有账号？
        <Link href="/register" className="text-sky-600 hover:underline">
          立即注册
        </Link>
      </p>
    </form>
  );
}
