/**
 * 基础 UI 组件。
 * 不依赖任何组件库，统一在此维护样式，页面里只关心内容。
 */
import type { ReactNode } from "react";

const inputClass =
  "field-control w-full rounded-lg border-2 px-3 py-2.5 text-sm text-slate-900 outline-none placeholder:text-slate-400 disabled:bg-slate-50";

export function Field({
  label,
  name,
  type = "text",
  defaultValue,
  error,
  required,
  placeholder,
  autoComplete,
  hint,
  inputMode,
}: {
  label: string;
  name: string;
  type?: string;
  defaultValue?: string;
  error?: string;
  required?: boolean;
  placeholder?: string;
  autoComplete?: string;
  hint?: string;
  inputMode?: "text" | "tel" | "email" | "numeric";
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-slate-700">
        {label}
        {required ? <span className="ml-0.5 text-red-500">*</span> : null}
      </span>
      <input
        className={inputClass}
        name={name}
        type={type}
        defaultValue={defaultValue}
        required={required}
        placeholder={placeholder}
        autoComplete={autoComplete}
        inputMode={inputMode}
      />
      {hint ? <span className="mt-1 block text-xs text-slate-500">{hint}</span> : null}
      {error ? <span className="mt-1 block text-xs text-red-600">{error}</span> : null}
    </label>
  );
}

export function Alert({ tone = "error", children }: { tone?: "error" | "success" | "info"; children: ReactNode }) {
  const styles = {
    error: "border-red-300 bg-red-50 text-red-700",
    success: "border-emerald-300 bg-emerald-50 text-emerald-700",
    info: "border-sky-300 bg-sky-50 text-sky-700",
  } as const;
  return <div className={`rounded-lg border-2 px-3.5 py-3 text-sm ${styles[tone]}`}>{children}</div>;
}

export function SubmitButton({ pending, children }: { pending: boolean; children: ReactNode }) {
  return (
    <button
      type="submit"
      disabled={pending}
      className="group inline-flex w-full items-center justify-center gap-2 rounded-lg border-2 border-[#a9473a] bg-[#d86b54] px-4 py-2.5 text-sm font-bold text-white shadow-[3px_4px_0_#a9473a] transition hover:-translate-y-1 hover:bg-[#c95d49] hover:shadow-[4px_6px_0_#a9473a] disabled:cursor-not-allowed disabled:border-slate-400 disabled:bg-slate-400 disabled:shadow-none"
    >
      {pending ? (
        <>
          <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/35 border-t-white" />
          处理中…
        </>
      ) : children}
    </button>
  );
}

export function Card({ title, description, children }: { title?: string; description?: string; children: ReactNode }) {
  return (
    <section className="paper-panel p-6">
      {title ? <h2 className="section-heading text-lg font-bold text-slate-900">{title}</h2> : null}
      {description ? <p className="mt-1 text-sm leading-6 text-slate-500">{description}</p> : null}
      <div className={title ? "mt-4" : ""}>{children}</div>
    </section>
  );
}
