import type { Metadata } from "next";
import { AdminCategoryForm } from "@/components/admin-category-form";
import { AdminRagConfigForm } from "@/components/admin-rag-config-form";
import { Card } from "@/components/ui";
import { prisma } from "@/lib/db";
import { getRagConfig } from "@/lib/rag/config";
import { toggleCategoryAction } from "@/server/admin-actions";

export const metadata: Metadata = { title: "配置中心 · 校园失物招领平台" };

/** 配置中心：类别与匹配参数都可在后台调整（CLFP-USR-0025） */
export default async function AdminConfigPage() {
  const [config, categories, postCounts] = await Promise.all([
    getRagConfig(),
    prisma.category.findMany({ orderBy: { sortOrder: "asc" } }),
    prisma.post.groupBy({ by: ["categoryId"], _count: { _all: true } }),
  ]);

  const countByCategory = new Map(postCounts.map((item) => [item.categoryId, item._count._all]));

  return (
    <div className="space-y-6">
      <Card
        title="匹配配置"
        description="调整后立即生效，新发布的信息会按新参数计算匹配；如需重算历史数据，请运行 npm run rag:rebuild"
      >
        <AdminRagConfigForm
          defaults={{
            threshold: config.threshold,
            maxMatches: config.maxMatches,
            windowDays: config.windowDays,
            weights: config.weights as unknown as Record<string, number>,
          }}
        />
      </Card>

      <Card title="物品类别" description="停用后不再出现在发布表单与筛选中，历史信息保留">
        <ul className="divide-y divide-slate-100">
          {categories.map((category) => (
            <li key={category.id} className="flex items-center justify-between gap-3 py-3">
              <div>
                <p className="text-sm text-slate-900">
                  {category.name}
                  {category.enabled ? null : (
                    <span className="ml-2 rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-500">
                      已停用
                    </span>
                  )}
                </p>
                <p className="text-xs text-slate-500">
                  已有 {countByCategory.get(category.id) ?? 0} 条信息 · 排序 {category.sortOrder}
                </p>
              </div>

              <form action={toggleCategoryAction}>
                <input type="hidden" name="categoryId" value={category.id} />
                <button
                  type="submit"
                  className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-50"
                >
                  {category.enabled ? "停用" : "启用"}
                </button>
              </form>
            </li>
          ))}
        </ul>

        <div className="mt-4 border-t border-slate-100 pt-4">
          <AdminCategoryForm />
        </div>
      </Card>

      <Card title="模型接入说明" description="如何从本地降级模式切换到真实向量模型">
        <ol className="list-decimal space-y-1 pl-5 text-sm text-slate-600">
          <li>
            在 <code className="rounded bg-slate-100 px-1">.env</code> 中设置{" "}
            <code className="rounded bg-slate-100 px-1">RAG_PROVIDER=openai</code>
          </li>
          <li>
            填写 <code className="rounded bg-slate-100 px-1">RAG_EMBED_BASE_URL</code>、
            <code className="rounded bg-slate-100 px-1">RAG_EMBED_API_KEY</code>、
            <code className="rounded bg-slate-100 px-1">RAG_EMBED_MODEL</code>、
            <code className="rounded bg-slate-100 px-1">RAG_EMBED_DIM</code>
          </li>
          <li>重启服务后运行 npm run rag:rebuild 重建全部向量</li>
        </ol>
        <p className="mt-2 text-xs text-slate-500">
          当前向量模型：
          <span className="font-medium text-slate-700">
            {config.provider === "mock" ? "本地降级模式（未配置外部模型）" : config.provider}
          </span>
        </p>
      </Card>
    </div>
  );
}
