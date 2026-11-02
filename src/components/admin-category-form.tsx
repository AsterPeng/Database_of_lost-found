"use client";

import { useActionState } from "react";
import { Alert, Field, SubmitButton } from "@/components/ui";
import { emptyFormState, type FormState } from "@/lib/form-state";
import { createCategoryAction } from "@/server/admin-actions";

/** 新增物品类别（CLFP-USR-0025：不改代码即可新增类别） */
export function AdminCategoryForm() {
  const [state, formAction, pending] = useActionState<FormState, FormData>(
    createCategoryAction,
    emptyFormState,
  );

  return (
    <form action={formAction} className="space-y-3">
      {state.error ? <Alert>{state.error}</Alert> : null}
      {state.success ? <Alert tone="success">{state.success}</Alert> : null}

      <Field
        label="新类别名称"
        name="name"
        required
        placeholder="例如：水杯水壶"
        hint="新增后立即出现在发布表单与筛选条件里，无需修改代码"
        error={state.fieldErrors?.name}
      />
      <SubmitButton pending={pending}>新增类别</SubmitButton>
    </form>
  );
}
