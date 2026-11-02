/**
 * P4 角色、列级授权与 RLS 演示。
 *
 * 前提：已在目标数据库执行 db/sql/06_roles_rls.sql，且当前账号 clfp 是这些角色的成员。
 * 用法（只允许测试库）：
 *   cd "D:\ClaudeCodeProjects\校园失物招领-test"
 *   npx tsx scripts/db/roles-demo.ts
 */
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { PrismaClient, type Prisma } from "@prisma/client";

const prisma = new PrismaClient();

if (!/test/i.test(process.env.DATABASE_URL ?? "")) {
  console.error(
    "拒绝执行：roles-demo 会创建临时账号，请把 DATABASE_URL 指向测试库（例如 clfp_test）。",
  );
  process.exit(1);
}

const suffix = randomBytes(5).toString("hex");

function isPermissionDenied(error: unknown): boolean {
  const value = error as {
    code?: string;
    meta?: { code?: string };
    message?: string;
  };
  return (
    value?.meta?.code === "42501" ||
    value?.code === "42501" ||
    /42501|permission denied|权限不够|没有权限|拒绝访问/.test(value?.message ?? "")
  );
}

async function expectAllowed<T>(
  role: string,
  label: string,
  run: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  const result = await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SET LOCAL ROLE ${role}`);
    return run(tx);
  });
  console.log(`  ✓ ${label}`);
  return result;
}

async function expectDenied(role: string, label: string, sql: string): Promise<void> {
  try {
    await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SET LOCAL ROLE ${role}`);
      await tx.$queryRawUnsafe(sql);
    });
    throw new Error(`预期被拒绝但执行成功：${label}`);
  } catch (error) {
    if (isPermissionDenied(error)) {
      console.log(`  ✓ ${label} 被拒绝`);
      return;
    }
    throw error;
  }
}

async function visibleIdsAsUser(
  userId: string,
  table: "notifications" | "claims" | "contact_grants",
): Promise<string[]> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe("SET LOCAL ROLE clfp_rls_demo");
    await tx.$queryRaw`SELECT set_config('app.current_user_id', ${userId}, true)`;
    const rows = await tx.$queryRawUnsafe<Array<{ id: string }>>(
      `SELECT id FROM ${table}`,
    );
    return rows.map((row) => row.id);
  });
}

async function main() {
  const userA = await prisma.user.create({
    data: {
      email: `roles-a-${suffix}@example.invalid`,
      passwordHash: "temporary-roles-demo",
      nickname: "RLS 用户 A",
      role: "USER",
      status: "ACTIVE",
      profileCompleted: true,
    },
  });
  const userB = await prisma.user.create({
    data: {
      email: `roles-b-${suffix}@example.invalid`,
      passwordHash: "temporary-roles-demo",
      nickname: "RLS 用户 B",
      role: "USER",
      status: "ACTIVE",
      profileCompleted: true,
    },
  });

  let categoryId: string | undefined;
  try {
    const category = await prisma.category.create({
      data: { name: `Roles Category ${suffix}` },
    });
    categoryId = category.id;

    const post = await prisma.post.create({
      data: {
        authorId: userA.id,
        type: "LOST",
        title: `Roles post ${suffix}`,
        description: "Temporary post for role and RLS demo",
        categoryId: category.id,
        location: "Library",
        occurredAt: new Date(),
        status: "OPEN",
      },
    });

    const claim = await prisma.claim.create({
      data: {
        postId: post.id,
        claimantId: userB.id,
        message: "Temporary claim for role and RLS demo",
        proof: "Only the owner knows this",
        contactEncrypted: "demo-placeholder",
        contactMasked: "139****0000",
        escalateAt: new Date(Date.now() + 48 * 60 * 60 * 1000),
      },
    });

    const grant = await prisma.contactGrant.create({
      data: {
        claimId: claim.id,
        grantorId: userA.id,
        granteeId: userB.id,
      },
    });

    const notificationA = await prisma.notification.create({
      data: {
        userId: userA.id,
        type: "SYSTEM",
        title: `通知 A ${suffix}`,
        body: "只应被 A 看到",
      },
    });
    const notificationB = await prisma.notification.create({
      data: {
        userId: userB.id,
        type: "SYSTEM",
        title: `通知 B ${suffix}`,
        body: "只应被 B 看到",
      },
    });

    console.log("1. clfp_readonly：公开只读与列级权限");
    await expectAllowed("clfp_readonly", "读取用户公开列", async (tx) => {
      const rows = await tx.$queryRawUnsafe<Array<{ id: string; nickname: string }>>(
        "SELECT id, nickname FROM users LIMIT 5",
      );
      assert.ok(rows.length >= 1);
    });
    await expectAllowed("clfp_readonly", "读取公开帖子视图", async (tx) => {
      const rows = await tx.$queryRawUnsafe<Array<{ id: string }>>(
        "SELECT id, title FROM v_public_posts LIMIT 5",
      );
      assert.ok(rows.length >= 1);
    });
    await expectDenied(
      "clfp_readonly",
      "读取 phone_encrypted",
      "SELECT phone_encrypted FROM users LIMIT 1",
    );
    await expectDenied(
      "clfp_readonly",
      "读取 password_hash",
      "SELECT password_hash FROM users LIMIT 1",
    );
    await expectDenied(
      "clfp_readonly",
      "读取 claims 表",
      "SELECT contact_encrypted FROM claims LIMIT 1",
    );

    console.log("2. clfp_stats：统计视图与函数，禁止基础表敏感列");
    await expectAllowed("clfp_stats", "读取管理汇总视图", async (tx) => {
      const rows = await tx.$queryRawUnsafe<Array<Record<string, unknown>>>(
        "SELECT * FROM v_admin_dashboard",
      );
      assert.equal(rows.length, 1);
    });
    await expectAllowed("clfp_stats", "调用 fn_stats", async (tx) => {
      const rows = await tx.$queryRawUnsafe<Array<{ stats: unknown }>>(
        "SELECT fn_stats(NULL::timestamptz, NULL::timestamptz, NULL::text) AS stats",
      );
      assert.ok(rows[0]?.stats);
    });
    await expectDenied(
      "clfp_stats",
      "读取 phone_encrypted",
      "SELECT phone_encrypted FROM users LIMIT 1",
    );
    await expectDenied(
      "clfp_stats",
      "读取 contact_encrypted",
      "SELECT contact_encrypted FROM claims LIMIT 1",
    );

    console.log("3. clfp_app：应用 DML 角色，无 DDL");
    await expectAllowed("clfp_app", "读取通知表", async (tx) => {
      const rows = await tx.$queryRawUnsafe<Array<{ n: number }>>(
        "SELECT count(*)::int AS n FROM notifications",
      );
      assert.ok(Number(rows[0]?.n ?? 0) >= 2);
    });
    await expectDenied(
      "clfp_app",
      "执行 CREATE TABLE",
      "CREATE TABLE public.roles_demo_should_fail (id int)",
    );

    console.log("4. clfp_rls_demo：行级安全");
    const aNotifications = await visibleIdsAsUser(userA.id, "notifications");
    const bNotifications = await visibleIdsAsUser(userB.id, "notifications");
    assert.deepEqual(aNotifications, [notificationA.id]);
    assert.deepEqual(bNotifications, [notificationB.id]);
    console.log("  ✓ A 只能看到自己的通知，B 只能看到自己的通知");

    const aClaims = await visibleIdsAsUser(userA.id, "claims");
    const bClaims = await visibleIdsAsUser(userB.id, "claims");
    assert.deepEqual(aClaims, [claim.id]);
    assert.deepEqual(bClaims, [claim.id]);
    console.log("  ✓ 认领对帖子作者 A 与申请人 B 可见");

    const aGrants = await visibleIdsAsUser(userA.id, "contact_grants");
    const bGrants = await visibleIdsAsUser(userB.id, "contact_grants");
    assert.deepEqual(aGrants, [grant.id]);
    assert.deepEqual(bGrants, [grant.id]);
    console.log("  ✓ 联系方式授权对授权方 A 与被授权方 B 可见");

    const unknownNotifications = await visibleIdsAsUser("unknown-user-id", "notifications");
    const unknownClaims = await visibleIdsAsUser("unknown-user-id", "claims");
    const unknownGrants = await visibleIdsAsUser("unknown-user-id", "contact_grants");
    assert.deepEqual(unknownNotifications, []);
    assert.deepEqual(unknownClaims, []);
    assert.deepEqual(unknownGrants, []);
    console.log("  ✓ 未设置 app.current_user_id 时看不到任何行");

    console.log("P4 角色、列级授权与 RLS 演示全部通过");
  } finally {
    await prisma.user.deleteMany({
      where: { id: { in: [userA.id, userB.id] } },
    });
    if (categoryId) {
      await prisma.category.delete({ where: { id: categoryId } }).catch(() => undefined);
    }
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});