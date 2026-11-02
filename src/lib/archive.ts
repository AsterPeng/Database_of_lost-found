/**
 * 归档规则（CLFP-USR-0021）。
 *
 * 学校教务系统没有对接条件，因此按已确认的口径：从学号/工号里推算入学年份，
 * 本科按 4 年、研究生按 3 年、教职工不自动归档，到期由管理员一键批量归档。
 * 归档后账号下未完成的信息不再对外公开展示，管理员仍可查询历史记录。
 */
import { prisma } from "./db";

/** 从学号里取入学年份：2023010101 → 2023 */
export function enrollmentYearOf(studentNo: string | null, role: "USER" | "ADMIN"): number | null {
  if (role === "ADMIN") return null;
  if (!studentNo) return null;

  const match = studentNo.match(/^(\d{4})/);
  if (!match) return null;

  const year = Number(match[1]);
  const currentYear = new Date().getFullYear();
  // 合理范围校验，避免把非学号格式误判
  if (year < currentYear - 12 || year > currentYear + 1) return null;
  return year;
}

/** 学号第 5 位常见约定：1-2 本科、3 硕士、4 博士；无法判断时按本科处理 */
export function programLengthOf(studentNo: string | null): number {
  if (!studentNo) return 4;
  const digit = studentNo.slice(4, 5);
  if (digit === "3") return 3;
  if (digit === "4") return 5;
  return 4;
}

export type GraduationInfo = {
  enrollmentYear: number;
  programLength: number;
  graduationYear: number;
  graduated: boolean;
};

export function graduationInfoOf(
  studentNo: string | null,
  role: "USER" | "ADMIN",
): GraduationInfo | null {
  const enrollmentYear = enrollmentYearOf(studentNo, role);
  if (enrollmentYear === null) return null;

  const programLength = programLengthOf(studentNo);
  const graduationYear = enrollmentYear + programLength;

  return {
    enrollmentYear,
    programLength,
    graduationYear,
    graduated: new Date().getFullYear() >= graduationYear,
  };
}

/**
 * 批量归档已毕业或离职的账号：
 * 1. 账号状态置为 ARCHIVED，无法再登录；
 * 2. 该账号下未完成的帖子标记 archivedAt，不再对外公开；
 * 3. 已完成的历史记录保留，管理员仍可查询。
 */
export async function archiveGraduatedUsers(): Promise<{ users: number; posts: number }> {
  const candidates = await prisma.user.findMany({
    where: { role: "USER", status: "ACTIVE" },
    select: { id: true, studentNo: true, role: true },
  });

  const targets = candidates.filter((user) => graduationInfoOf(user.studentNo, user.role)?.graduated);
  if (targets.length === 0) return { users: 0, posts: 0 };

  const ids = targets.map((user) => user.id);

  const posts = await prisma.post.updateMany({
    where: { authorId: { in: ids }, status: "OPEN", archivedAt: null, deletedAt: null },
    data: { archivedAt: new Date() },
  });

  await prisma.user.updateMany({ where: { id: { in: ids } }, data: { status: "ARCHIVED" } });

  return { users: ids.length, posts: posts.count };
}

/** 手动归档单个账号 */
export async function archiveUser(userId: string): Promise<{ posts: number }> {
  const posts = await prisma.post.updateMany({
    where: { authorId: userId, status: "OPEN", archivedAt: null, deletedAt: null },
    data: { archivedAt: new Date() },
  });
  await prisma.user.update({ where: { id: userId }, data: { status: "ARCHIVED" } });
  return { posts: posts.count };
}

/** 取消归档：账号恢复可用，帖子恢复公开 */
export async function unarchiveUser(userId: string): Promise<{ posts: number }> {
  const posts = await prisma.post.updateMany({
    where: { authorId: userId, archivedAt: { not: null } },
    data: { archivedAt: null },
  });
  await prisma.user.update({ where: { id: userId }, data: { status: "ACTIVE" } });
  return { posts: posts.count };
}
