/**
 * Prisma 客户端单例。
 * 开发模式下 Next.js 会热重载模块，若不缓存实例会不断创建新的数据库连接。
 */
import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
