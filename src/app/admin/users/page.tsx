import type { Metadata } from "next";
import { Card } from "@/components/ui";
import { graduationInfoOf } from "@/lib/archive";
import { prisma } from "@/lib/db";
import { formatDateTime } from "@/lib/datetime";
import {
  archiveGraduatedAction,
  archiveUserAction,
  banUserAction,
  unarchiveUserAction,
  unbanUserAction,
} from "@/server/user-admin-actions";

export const metadata: Metadata = { title: "用户管理 · 校园失物招领平台" };

const STATUS_LABEL = {
  ACTIVE: "正常",
  BANNED: "已禁用",
  ARCHIVED: "已归档",
} as const;

const STATUS_STYLE = {
  ACTIVE: "bg-emerald-50 text-emerald-700",
  BANNED: "bg-red-50 text-red-600",
  ARCHIVED: "bg-slate-100 text-slate-500",
} as const;

/** 用户管理：禁用与归档（CLFP-USR-0002、0021） */
export default async function AdminUsersPage() {
  const users = await prisma.user.findMany({
    orderBy: { createdAt: "desc" },
    take: 100,
    include: { _count: { select: { posts: true, claims: true } } },
  });

  const graduated = users.filter(
    (user) => user.status === "ACTIVE" && graduationInfoOf(user.studentNo, user.role)?.graduated,
  );

  return (
    <div className="space-y-6">
      <Card
        title="按学号自动归档毕业生"
        description="学号前 4 位为入学年份，本科按 4 年、研究生按 3 年推算；归档后账号无法登录，未完成的信息不再公开"
      >
        <p className="text-sm text-slate-600">
          当前有 <span className="font-medium text-slate-900">{graduated.length}</span> 个账号按学号推算已到毕业年份。
        </p>
        <form action={archiveGraduatedAction} className="mt-3">
          <button
            type="submit"
            className="rounded-lg bg-slate-800 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700"
          >
            批量归档这些账号
          </button>
        </form>
      </Card>

      <Card title="用户列表">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[880px] text-left text-sm">
            <thead className="border-b border-slate-200 text-xs text-slate-500">
              <tr>
                <th className="py-2 font-medium">用户</th>
                <th className="py-2 font-medium">学号 / 院系</th>
                <th className="py-2 font-medium">毕业推算</th>
                <th className="py-2 font-medium">发布</th>
                <th className="py-2 font-medium">状态</th>
                <th className="py-2 font-medium">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {users.map((user) => {
                const info = graduationInfoOf(user.studentNo, user.role);
                return (
                  <tr key={user.id}>
                    <td className="py-2">
                      <p className="text-slate-900">{user.nickname}</p>
                      <p className="text-xs text-slate-400">{user.email}</p>
                    </td>
                    <td className="py-2 text-xs text-slate-600">
                      <p>{user.studentNo ?? "未填写"}</p>
                      <p className="text-slate-400">{user.department ?? "未填写院系"}</p>
                    </td>
                    <td className="py-2 text-xs text-slate-600">
                      {user.role === "ADMIN" ? (
                        <span className="text-slate-400">管理员</span>
                      ) : info ? (
                        <>
                          <p>{info.enrollmentYear} 级 · {info.programLength} 年制</p>
                          <p className={info.graduated ? "text-amber-600" : "text-slate-400"}>
                            {info.graduated ? "已到毕业年份" : `${info.graduationYear} 年毕业`}
                          </p>
                        </>
                      ) : (
                        <span className="text-slate-400">学号无法识别</span>
                      )}
                    </td>
                    <td className="py-2 text-xs text-slate-600">
                      {user._count.posts} 条 · 认领 {user._count.claims}
                    </td>
                    <td className="py-2">
                      <span className={`rounded px-2 py-0.5 text-xs ${STATUS_STYLE[user.status]}`}>
                        {STATUS_LABEL[user.status]}
                      </span>
                      <p className="mt-1 text-xs text-slate-400">
                        注册 {formatDateTime(user.createdAt)}
                      </p>
                    </td>
                    <td className="py-2">
                      {user.role === "ADMIN" ? (
                        <span className="text-xs text-slate-400">—</span>
                      ) : (
                        <div className="flex flex-wrap gap-1.5">
                          {user.status === "BANNED" ? (
                            <form action={unbanUserAction}>
                              <input type="hidden" name="userId" value={user.id} />
                              <button className="rounded border border-emerald-300 px-2 py-1 text-xs text-emerald-700 hover:bg-emerald-50">
                                解除禁用
                              </button>
                            </form>
                          ) : (
                            <form action={banUserAction}>
                              <input type="hidden" name="userId" value={user.id} />
                              <button className="rounded border border-red-200 px-2 py-1 text-xs text-red-600 hover:bg-red-50">
                                禁用
                              </button>
                            </form>
                          )}

                          {user.status === "ARCHIVED" ? (
                            <form action={unarchiveUserAction}>
                              <input type="hidden" name="userId" value={user.id} />
                              <button className="rounded border border-slate-300 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50">
                                取消归档
                              </button>
                            </form>
                          ) : (
                            <form action={archiveUserAction}>
                              <input type="hidden" name="userId" value={user.id} />
                              <button className="rounded border border-slate-300 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50">
                                归档
                              </button>
                            </form>
                          )}
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
