"use client";

import { useActionState } from "react";
import { Alert, SubmitButton } from "@/components/ui";
import { emptyFormState, type FormState } from "@/lib/form-state";
import { saveRagConfigAction } from "@/server/admin-actions";

const WEIGHT_FIELDS = [
  { name: "weightVector", label: "向量相似度" },
  { name: "weightCategory", label: "类别匹配" },
  { name: "weightLocation", label: "地点匹配" },
  { name: "weightTime", label: "时间接近度" },
  { name: "weightKeyword", label: "关键词重合" },
] as const;

const inputClass =
  "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-100";

/** 匹配配置表单（CLFP-USR-0025：不改代码即可调阈值与权重） */
export function AdminRagConfigForm({
  defaults,
}: {
  defaults: {
    threshold: number;
    maxMatches: number;
    windowDays: number;
    weights: Record<string, number>;
  };
}) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(
    saveRagConfigAction,
    emptyFormState,
  );

  return (
    <form action={formAction} className="space-y-4">
      {state.error ? <Alert>{state.error}</Alert> : null}
      {state.success ? <Alert tone="success">{state.success}</Alert> : null}

      <div className="grid gap-4 sm:grid-cols-3">
        <label className="block">
          <span className="mb-1 block text-xs text-slate-500">匹配置信度阈值（0~1）</span>
          <input
            type="number"
            name="threshold"
            step="0.01"
            min="0"
            max="1"
            defaultValue={defaults.threshold}
            className={inputClass}
          />
          {state.fieldErrors?.threshold ? (
            <span className="mt-1 block text-xs text-red-600">{state.fieldErrors.threshold}</span>
          ) : null}
        </label>

        <label className="block">
          <span className="mb-1 block text-xs text-slate-500">每条最多推荐（1~10）</span>
          <input
            type="number"
            name="maxMatches"
            min="1"
            max="10"
            defaultValue={defaults.maxMatches}
            className={inputClass}
          />
          {state.fieldErrors?.maxMatches ? (
            <span className="mt-1 block text-xs text-red-600">{state.fieldErrors.maxMatches}</span>
          ) : null}
        </label>

        <label className="block">
          <span className="mb-1 block text-xs text-slate-500">匹配时间窗（天）</span>
          <input
            type="number"
            name="windowDays"
            min="1"
            max="365"
            defaultValue={defaults.windowDays}
            className={inputClass}
          />
          {state.fieldErrors?.windowDays ? (
            <span className="mt-1 block text-xs text-red-600">{state.fieldErrors.windowDays}</span>
          ) : null}
        </label>
      </div>

      <div>
        <p className="mb-2 text-xs text-slate-500">
          打分权重（0~1，会按总和归一化；建议保持合计为 1）
        </p>
        <div className="grid gap-3 sm:grid-cols-5">
          {WEIGHT_FIELDS.map((field) => {
            const key = field.name.replace("weight", "");
            const errorKey = field.name;
            return (
              <label key={field.name} className="block">
                <span className="mb-1 block text-xs text-slate-500">{field.label}</span>
                <input
                  type="number"
                  name={field.name}
                  step="0.01"
                  min="0"
                  max="1"
                  defaultValue={defaults.weights[key.toLowerCase()] ?? 0}
                  className={inputClass}
                />
                {state.fieldErrors?.[errorKey] ? (
                  <span className="mt-1 block text-xs text-red-600">
                    {state.fieldErrors[errorKey]}
                  </span>
                ) : null}
              </label>
            );
          })}
        </div>
      </div>

      <SubmitButton pending={pending}>保存匹配配置</SubmitButton>
    </form>
  );
}
