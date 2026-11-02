/**
 * 种子数据脚本：创建管理员账号与演示用普通账号。
 * 运行：npm run db:seed
 */
import "../scripts/_env";
import { PrismaClient } from "@prisma/client";
import { randomBytes } from "node:crypto";
import { hashPassword, encryptField, maskPhone } from "../src/lib/crypto";

const prisma = new PrismaClient();

async function main() {
  const adminPassword = process.env.SEED_ADMIN_PASSWORD ?? "Admin@12345";
  const demoPassword = process.env.SEED_DEMO_PASSWORD ?? "Demo@12345";

  const admin = await prisma.user.upsert({
    where: { email: "admin@clfp.local" },
    update: {},
    create: {
      email: "admin@clfp.local",
      passwordHash: await hashPassword(adminPassword),
      nickname: "平台管理员",
      realName: "系统管理员",
      studentNo: "ADMIN001",
      department: "信息中心",
      phoneEncrypted: encryptField("13800000000"),
      phoneMasked: maskPhone("13800000000"),
      role: "ADMIN",
      profileCompleted: true,
    },
  });

  const demoPhone = "13900000001";
  const demo = await prisma.user.upsert({
    where: { email: "student@clfp.local" },
    update: {},
    create: {
      email: "student@clfp.local",
      passwordHash: await hashPassword(demoPassword),
      nickname: "演示同学",
      realName: "张同学",
      studentNo: "2023010101",
      department: "计算机科学与技术学院",
      phoneEncrypted: encryptField(demoPhone),
      phoneMasked: maskPhone(demoPhone),
      role: "USER",
      profileCompleted: true,
    },
  });

  // 初始物品类别（CLFP-USR-0025：类别可配置，这里只做首次初始化）
  const { DEFAULT_CATEGORIES } = await import("../src/lib/constants");
  for (const [index, name] of DEFAULT_CATEGORIES.entries()) {
    await prisma.category.upsert({
      where: { name },
      update: {},
      create: { name, sortOrder: index },
    });
  }
  console.log(`类别已初始化：${DEFAULT_CATEGORIES.join("、")}`);

  console.log("种子数据已就绪：");
  console.log(`  管理员  ${admin.email}  密码 ${adminPassword}`);
  console.log(`  演示账号 ${demo.email}  密码 ${demoPassword}`);
  if (!process.env.SEED_ADMIN_PASSWORD) {
    console.log(`  （管理员密码为默认值，可用 SEED_ADMIN_PASSWORD 环境变量覆盖）`);
  }
  console.log(`  随机串校验：${randomBytes(4).toString("hex")}`);
}

main()
  .catch((error) => {
    console.error("种子数据写入失败：", error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
