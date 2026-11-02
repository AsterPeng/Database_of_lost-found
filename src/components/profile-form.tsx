"use client";

import { useActionState } from "react";
import { Alert, Field, SubmitButton } from "@/components/ui";
import { emptyFormState } from "@/lib/form-state";
import { completeProfileAction, updateProfileAction } from "@/server/auth-actions";

export type ProfileDefaults = {
  nickname?: string;
  realName?: string;
  studentNo?: string;
  department?: string;
  phone?: string;
};

/**
 * 校内身份资料表单。
 * onboarding —— 首次登录补充资料（CLFP-USR-0001），提交后进入个人中心
 * settings   —— 账号设置里修改资料
 */
export function ProfileForm({
  mode,
  defaults = {},
}: {
  mode: "onboarding" | "settings";
  defaults?: ProfileDefaults;
}) {
  const action = mode === "onboarding" ? completeProfileAction : updateProfileAction;
  const [state, formAction, pending] = useActionState<typeof emptyFormState, FormData>(
    action,
    emptyFormState,
  );

  return (
    <form action={formAction} className="space-y-4">
      {state.error ? <Alert>{state.error}</Alert> : null}
      {state.success ? <Alert tone="success">{state.success}</Alert> : null}

      {mode === "settings" ? (
        <Field
          label="昵称"
          name="nickname"
          required
          defaultValue={defaults.nickname}
          error={state.fieldErrors?.nickname}
        />
      ) : null}

      <Field
        label="真实姓名"
        name="realName"
        required
        defaultValue={defaults.realName}
        error={state.fieldErrors?.realName}
      />
      <Field
        label="学号 / 工号"
        name="studentNo"
        required
        defaultValue={defaults.studentNo}
        hint="用于校内身份核验"
        error={state.fieldErrors?.studentNo}
      />
      <Field
        label="所属院系"
        name="department"
        required
        defaultValue={defaults.department}
        placeholder="例如：计算机科学与技术学院"
        error={state.fieldErrors?.department}
      />
      <Field
        label="手机号"
        name="phone"
        required
        inputMode="tel"
        autoComplete="tel"
        defaultValue={defaults.phone}
        hint="加密存储，公共页面默认脱敏显示"
        error={state.fieldErrors?.phone}
      />

      <SubmitButton pending={pending}>
        {mode === "onboarding" ? "提交并进入平台" : "保存资料"}
      </SubmitButton>
    </form>
  );
}
