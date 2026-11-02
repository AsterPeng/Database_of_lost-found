/** 表单动作的统一状态类型，供 useActionState 使用 */
export type FormState = {
  error?: string;
  fieldErrors?: Record<string, string>;
  success?: string;
};

export const emptyFormState: FormState = {};
