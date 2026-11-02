/**
 * P5 隔离级别实验（PostgreSQL）。
 *
 * 覆盖：
 *   1. 不可重复读：READ COMMITTED 会看到第二次提交，REPEATABLE READ / SERIALIZABLE 保持快照
 *   2. 幻读：READ COMMITTED 计数会变化，REPEATABLE READ / SERIALIZABLE 保持快照
 *   3. 丢失更新：READ COMMITTED 覆盖对方更新，REPEATABLE READ / SERIALIZABLE 抛 40001
 *   4. 脏读：PostgreSQL 的 READ UNCOMMITTED 等同 READ COMMITTED，看不到未提交数据
 *
 * 用法（只允许测试库）：
 *   cd "D:\ClaudeCodeProjects\校园失物招领-test"
 *   npx tsx scripts/db/isolation-levels.ts
 */
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { Prisma, PrismaClient } from "@prisma/client";

const databaseUrl = process.env.DATABASE_URL ?? "";
if (!/test/i.test(databaseUrl)) {
  console.error(
    "拒绝执行：isolation-levels 会创建临时数据，请把 DATABASE_URL 指向测试库（例如 clfp_test）。",
  );
  process.exit(1);
}

const url = new URL(databaseUrl);
url.searchParams.set("connection_limit", "10");
url.searchParams.set("pool_timeout", "30");
const prisma = new PrismaClient({ datasources: { db: { url: url.toString() } } });

const suffix = randomBytes(5).toString("hex");
const levels = [
  Prisma.TransactionIsolationLevel.ReadCommitted,
  Prisma.TransactionIsolationLevel.RepeatableRead,
  Prisma.TransactionIsolationLevel.Serializable,
] as const;

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function errorCode(error: unknown): string {
  const value = error as {
    code?: string;
    meta?: { code?: string; message?: string };
    message?: string;
  };
  return (
    value?.meta?.code ??
    value?.code ??
    value?.message?.match(/\b(40001|40P01|P2034)\b/)?.[1] ??
    "UNKNOWN_ERROR"
  );
}

async function nonRepeatableRead(level: Prisma.TransactionIsolationLevel) {
  const user = await prisma.user.create({
    data: {
      email: `isolation-nr-${level}-${suffix}@example.invalid`,
      passwordHash: "temporary-isolation-account",
      nickname: "before",
      role: "USER",
      status: "ACTIVE",
      profileCompleted: true,
    },
  });

  try {
    const t1Read = deferred();
    const t2Done = deferred();
    const t1 = prisma.$transaction(
      async (tx) => {
        const first = await tx.user.findUniqueOrThrow({
          where: { id: user.id },
          select: { nickname: true },
        });
        t1Read.resolve();
        await t2Done.promise;
        const second = await tx.user.findUniqueOrThrow({
          where: { id: user.id },
          select: { nickname: true },
        });
        return { first: first.nickname, second: second.nickname };
      },
      { isolationLevel: level, maxWait: 5000, timeout: 15000 },
    );

    await t1Read.promise;
    await prisma.user.update({
      where: { id: user.id },
      data: { nickname: "after" },
    });
    t2Done.resolve();
    const result = await t1;
    return result;
  } finally {
    await prisma.user.delete({ where: { id: user.id } }).catch(() => undefined);
  }
}

async function phantomRead(level: Prisma.TransactionIsolationLevel) {
  const author = await prisma.user.create({
    data: {
      email: `isolation-ph-${level}-${suffix}@example.invalid`,
      passwordHash: "temporary-isolation-account",
      nickname: "幻读作者",
      role: "USER",
      status: "ACTIVE",
      profileCompleted: true,
    },
  });
  const category = await prisma.category.create({
    data: { name: `Isolation Category ${level} ${suffix}` },
  });

  try {
    await prisma.post.create({
      data: {
        authorId: author.id,
        type: "LOST",
        title: `Phantom first ${level} ${suffix}`,
        description: "Temporary phantom verification post",
        categoryId: category.id,
        location: "Library",
        occurredAt: new Date(),
      },
    });

    const t1Read = deferred();
    const t2Done = deferred();
    const t1 = prisma.$transaction(
      async (tx) => {
        const first = await tx.post.count({ where: { categoryId: category.id } });
        t1Read.resolve();
        await t2Done.promise;
        const second = await tx.post.count({ where: { categoryId: category.id } });
        return { first, second };
      },
      { isolationLevel: level, maxWait: 5000, timeout: 15000 },
    );

    await t1Read.promise;
    await prisma.post.create({
      data: {
        authorId: author.id,
        type: "FOUND",
        title: `Phantom second ${level} ${suffix}`,
        description: "Temporary phantom verification post",
        categoryId: category.id,
        location: "Library",
        occurredAt: new Date(),
      },
    });
    t2Done.resolve();
    return await t1;
  } finally {
    await prisma.user.delete({ where: { id: author.id } }).catch(() => undefined);
    await prisma.category.delete({ where: { id: category.id } }).catch(() => undefined);
  }
}

async function lostUpdate(level: Prisma.TransactionIsolationLevel) {
  const key = `isolation-lost-${level}-${suffix}`;
  await prisma.appConfig.create({
    data: { key, value: { n: 0 } },
  });

  try {
    const t1Read = deferred();
    const t2Done = deferred();
    let t1Outcome = "updated";
    let t1Error: string | null = null;

    const t1 = prisma
      .$transaction(
        async (tx) => {
          const rows = await tx.$queryRaw<Array<{ n: string }>>`
            SELECT value->>'n' AS n FROM app_configs WHERE key = ${key}
          `;
          const read = Number(rows[0]?.n ?? 0);
          t1Read.resolve();
          await t2Done.promise;
          await tx.$executeRaw`
            UPDATE app_configs
            SET value = jsonb_set(value, '{n}', to_jsonb(${read + 1}::int)),
                updated_at = (now() AT TIME ZONE 'UTC')
            WHERE key = ${key}
          `;
          return { read, updated: true };
        },
        { isolationLevel: level, maxWait: 5000, timeout: 15000 },
      )
      .catch((error) => {
        t1Outcome = "serialization_failure";
        t1Error = errorCode(error);
        return null;
      });

    await t1Read.promise;
    await prisma.$executeRaw`
      UPDATE app_configs
      SET value = jsonb_set(value, '{n}', to_jsonb(10::int)),
          updated_at = (now() AT TIME ZONE 'UTC')
      WHERE key = ${key}
    `;
    t2Done.resolve();
    await t1;

    const rows = await prisma.$queryRaw<Array<{ n: string }>>`
      SELECT value->>'n' AS n FROM app_configs WHERE key = ${key}
    `;
    return { outcome: t1Outcome, error: t1Error, finalValue: Number(rows[0]?.n ?? -1) };
  } finally {
    await prisma.appConfig.delete({ where: { key } }).catch(() => undefined);
  }
}

async function dirtyRead() {
  const user = await prisma.user.create({
    data: {
      email: `isolation-dirty-${suffix}@example.invalid`,
      passwordHash: "temporary-isolation-account",
      nickname: "committed",
      role: "USER",
      status: "ACTIVE",
      profileCompleted: true,
    },
  });

  try {
    const t2Updated = deferred();
    const releaseT2 = deferred();
    let t2Error: unknown;

    const t2 = prisma
      .$transaction(
        async (tx) => {
          await tx.user.update({
            where: { id: user.id },
            data: { nickname: "uncommitted" },
          });
          t2Updated.resolve();
          await releaseT2.promise;
          throw new Error("ROLLBACK_FOR_DIRTY_READ_TEST");
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, maxWait: 5000, timeout: 15000 },
      )
      .catch((error) => {
        t2Error = error;
        return null;
      });

    await t2Updated.promise;
    const observed = await prisma.$transaction(
      async (tx) => {
        const row = await tx.user.findUniqueOrThrow({
          where: { id: user.id },
          select: { nickname: true },
        });
        return row.nickname;
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.ReadUncommitted,
        maxWait: 5000,
        timeout: 15000,
      },
    );

    releaseT2.resolve();
    await t2;
    assert.match(String((t2Error as Error)?.message), /ROLLBACK_FOR_DIRTY_READ_TEST/);
    return { observed, sawUncommitted: observed === "uncommitted" };
  } finally {
    await prisma.user.delete({ where: { id: user.id } }).catch(() => undefined);
  }
}

async function main() {
  const results: Array<Record<string, unknown>> = [];

  for (const level of levels) {
    const nr = await nonRepeatableRead(level);
    const ph = await phantomRead(level);
    const lu = await lostUpdate(level);

    results.push({
      隔离级别: level,
      不可重复读: `${nr.first} → ${nr.second}`,
      幻读计数: `${ph.first} → ${ph.second}`,
      丢失更新: `${lu.outcome}${lu.error ? `(${lu.error})` : ""}`,
      最终值: lu.finalValue,
    });

    if (level === Prisma.TransactionIsolationLevel.ReadCommitted) {
      assert.deepEqual(nr, { first: "before", second: "after" });
      assert.deepEqual(ph, { first: 1, second: 2 });
      assert.equal(lu.outcome, "updated");
      assert.equal(lu.finalValue, 1);
    } else {
      assert.deepEqual(nr, { first: "before", second: "before" });
      assert.deepEqual(ph, { first: 1, second: 1 });
      assert.equal(lu.outcome, "serialization_failure");
      assert.equal(lu.finalValue, 10);
    }
  }

  const dirty = await dirtyRead();
  assert.equal(dirty.observed, "committed");
  assert.equal(dirty.sawUncommitted, false);

  console.log("隔离级别实验结果：");
  console.table(results);
  console.log(
    `脏读实验：READ UNCOMMITTED 读到 "${dirty.observed}"，未看到未提交值（PostgreSQL 将该级别视为 READ COMMITTED）`,
  );
  console.log("P5 隔离级别实验通过");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });