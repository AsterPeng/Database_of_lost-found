/** 公告查询（CLFP-USR-0024） */
import { prisma } from "./db";

/** 当前有效的公告：已到发布时间、未过期；置顶优先 */
export async function listActiveAnnouncements(limit = 3) {
  const now = new Date();
  return prisma.announcement.findMany({
    where: {
      publishedAt: { lte: now },
      OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
    },
    orderBy: [{ pinned: "desc" }, { publishedAt: "desc" }],
    take: limit,
  });
}

export async function listAllAnnouncements() {
  return prisma.announcement.findMany({
    orderBy: [{ pinned: "desc" }, { publishedAt: "desc" }],
    include: { createdBy: { select: { nickname: true } } },
    take: 100,
  });
}
