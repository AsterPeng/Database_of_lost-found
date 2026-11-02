"use client";

import Link from "next/link";
import { useActionState } from "react";
import { Alert, Field, SubmitButton } from "@/components/ui";
import { emptyFormState } from "@/lib/form-state";
import { registerAction } from "@/server/auth-actions";

export function RegisterForm() {
  const [state, formAction, pending] = useActionState(registerAction, emptyFormState);

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
        label="昵称"
        name="nickname"
        required
        autoComplete="nickname"
        placeholder="在平台上展示的名字"
        hint="昵称会公开显示，请不要填写真实姓名"
        error={state.fieldErrors?.nickname}
      />
      <Field
        label="密码"
        name="password"
        type="password"
        required
        autoComplete="new-password"
        hint="至少 8 位"
        error={state.fieldErrors?.password}
      />
      <Field
        label="确认密码"
        name="confirmPassword"
        type="password"
        required
        autoComplete="new-password"
        error={state.fieldErrors?.confirmPassword}
      />

      <SubmitButton pending={pending}>注册</SubmitButton>

      <p className="text-center text-sm text-slate-500">
        已有账号？
        <Link href="/login" className="text-sky-600 hover:underline">
          去登录
        </Link>
      </p>
    </form>
  );
}
