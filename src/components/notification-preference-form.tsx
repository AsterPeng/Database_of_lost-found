"use client";

import { useActionState } from "react";
import { Alert, SubmitButton } from "@/components/ui";
import { emptyFormState, type FormState } from "@/lib/form-state";
import { updateNotificationPreferenceAction } from "@/server/notification-actions";

const HOURS = Array.from({ length: 24 }, (_, hour) => hour);
const selectClass =
  "rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm outline-none focus:border-sky-500";

function hourLabel(hour: number): string {
  return `${String(hour).padStart(2, "0")}:00`;
}

/** 消息接收偏好与免打扰时段（CLFP-USR-0019） */
export function NotificationPreferenceForm({
  defaults,
}: {
  defaults: { inApp: boolean; email: boolean; quietEnabled: boolean; quietStart: number; quietEnd: number };
}) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(
    updateNotificationPreferenceAction,
    emptyFormState,
  );

  return (
    <form action={formAction} className="space-y-4">
      {state.error ? <Alert>{state.error}</Alert> : null}
      {state.success ? <Alert tone="success">{state.success}</Alert> : null}

      <label className="flex items-start gap-3">
        <input
          type="checkbox"
          name="inApp"
          defaultChecked={defaults.inApp}
          className="mt-0.5 h-4 w-4 rounded border-slate-300"
        />
        <span>
          <span className="block text-sm font-medium text-slate-800">接收站内通知</span>
          <span className="block text-xs text-slate-500">
            匹配推荐、认领申请、审核结果与交接提醒都会出现在通知中心
          </span>
        </span>
      </label>

      <label className="flex items-start gap-3">
        <input
          type="checkbox"
          name="email"
          defaultChecked={defaults.email}
          className="mt-0.5 h-4 w-4 rounded border-slate-300"
        />
        <span>
          <span className="block text-sm font-medium text-slate-800">接收邮件通知</span>
          <span className="block text-xs text-slate-500">
            当前部署未接入邮件服务，偏好会被保存，接入后自动生效
          </span>
        </span>
      </label>

      <div className="rounded-xl border border-slate-200 p-4">
        <label className="flex items-start gap-3">
          <input
            type="checkbox"
            name="quietEnabled"
            defaultChecked={defaults.quietEnabled}
            className="mt-0.5 h-4 w-4 rounded border-slate-300"
          />
          <span>
            <span className="block text-sm font-medium text-slate-800">开启免打扰时段</span>
            <span className="block text-xs text-slate-500">
              时段内产生的通知不会立即送达，而是排队到时段结束后统一提示
            </span>
          </span>
        </label>

        <div className="mt-3 flex items-center gap-2 pl-7 text-sm text-slate-700">
          <span className="text-slate-500">从</span>
          <select name="quietStart" defaultValue={String(defaults.quietStart)} className={selectClass}>
            {HOURS.map((hour) => (
              <option key={hour} value={hour}>
                {hourLabel(hour)}
              </option>
            ))}
          </select>
          <span className="text-slate-500">到次日</span>
          <select name="quietEnd" defaultValue={String(defaults.quietEnd)} className={selectClass}>
            {HOURS.map((hour) => (
              <option key={hour} value={hour}>
                {hourLabel(hour)}
              </option>
            ))}
          </select>
        </div>
        {state.fieldErrors?.quietStart ? (
          <p className="mt-2 pl-7 text-xs text-red-600">{state.fieldErrors.quietStart}</p>
        ) : null}
        {state.fieldErrors?.quietEnd ? (
          <p className="mt-2 pl-7 text-xs text-red-600">{state.fieldErrors.quietEnd}</p>
        ) : null}
      </div>

      <SubmitButton pending={pending}>保存通知偏好</SubmitButton>
    </form>
  );
}
