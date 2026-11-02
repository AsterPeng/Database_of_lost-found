import type { ReactNode } from "react";

/** App Router 在每次页面导航时重新挂载模板，触发轻量进入动画。 */
export default function Template({ children }: { children: ReactNode }) {
  return <div className="page-transition">{children}</div>;
}
