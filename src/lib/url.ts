/** URL 查询串工具：筛选条件都写在 URL 里，方便分享与前进后退 */

export type QueryValues = Record<string, string | undefined>;

/** 在已有查询参数基础上覆盖若干项，返回可直接拼在路径后的字符串 */
export function buildQueryString(base: QueryValues, overrides: QueryValues = {}): string {
  const merged: QueryValues = { ...base, ...overrides };
  const params = new URLSearchParams();

  for (const [key, value] of Object.entries(merged)) {
    if (value !== undefined && value !== "") params.set(key, value);
  }

  const query = params.toString();
  return query ? `?${query}` : "";
}
