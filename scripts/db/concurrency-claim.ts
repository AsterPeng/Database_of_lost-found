/**
 * P5 并发认领实验。
 *
 * 场景 A：10 个并发请求抢同一条认领。
 * 场景 B：同一帖子有 10 条认领，10 个并发请求分别审核，验证只有一条通过。
 *
 * 用法（只允许测试库）：
 *   cd "D:\ClaudeCodeProjects\校园失物招领-test"
 *   npx tsx scripts/db/concurrency-claim.ts
 */
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { Prisma, PrismaClient } from "@prisma/client";

const databaseUrl = process.env.DATABASE_URL ?? "";
if (!/test/i.test(databaseUrl)) {
  console.error(
    "拒绝执行：concurrency-claim 会创建临时数据，请把 DATABASE_URL 指向测试库（例如 clfp_test）。",
  );
  process.exit(1);
}

// 允许 10 个并发语句同时占用连接
const url = new URL(databaseUrl);
url.searchParams.set("connection_limit", "20");
url.searchParams.set("pool_timeout", "30");
const prisma = new PrismaClient({ datasources: { db: { url: url.toString() } } });

const suffix = randomBytes(5).toString("hex");
const ROUNDS = 10;
const CONCURRENCY = 10;

type ReviewResult = {
  ok: boolean;
  code?: string;
  status?: string;
  rejectedClaims?: unknown[];
};

function parseJson<T>(value: unknown): T {
  return (typeof value === "string" ? JSON.parse(value) : value) as T;
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
    value?.message?.match(/\b(40P01|40001|23505|P2034)\b/)?.[1] ??
    "UNKNOWN_ERROR"
  );
}

async function reviewClaim(
  claimId: string,
  reviewerId: string,
): Promise<{ ok: boolean; code: string }> {
  try {
    const rows = await prisma.$queryRaw<Array<{ result: Prisma.JsonValue }>>`
      SELECT fn_review_claim(
        ${claimId}::text,
        ${reviewerId}::text,
        'ACCEPT',
        NULL
      ) AS result
    `;
    const result = parseJson<ReviewResult>(rows[0]?.result);
    return { ok: Boolean(result?.ok), code: result?.code ?? result?.status ?? "OK" };
  } catch (error) {
    return { ok: false, code: errorCode(error) };
  }
}

async function createUsers() {
  const author = await prisma.user.create({
    data: {
      email: `concurrency-author-${suffix}@example.invalid`,
      passwordHash: "temporary-concurrency-account",
      nickname: "并发作者",
      role: "USER",
      status: "ACTIVE",
      profileCompleted: true,
    },
  });

  const claimants = [];
  for (let index = 0; index < CONCURRENCY; index += 1) {
    claimants.push(
      await prisma.user.create({
        data: {
          email: `concurrency-claimant-${index}-${suffix}@example.invalid`,
          passwordHash: "temporary-concurrency-account",
          nickname: `并发申请人 ${index + 1}`,
          role: "USER",
          status: "ACTIVE",
          profileCompleted: true,
        },
      }),
    );
  }
  return { author, claimants };
}

async function createPost(authorId: string, categoryId: string, label: string) {
  return prisma.post.create({
    data: {
      authorId,
      type: "LOST",
      title: `并发实验-${label}-${suffix}`,
      description: "Temporary concurrency verification post",
      categoryId,
      location: "Library",
      occurredAt: new Date(),
      status: "OPEN",
    },
  });
}

async function createClaim(postId: string, claimantId: string) {
  return prisma.claim.create({
    data: {
      postId,
      claimantId,
      message: "Temporary concurrency verification claim",
      proof: "A feature only the owner knows",
      contactEncrypted: "concurrency-placeholder",
      contactMasked: "138****0000",
      escalateAt: new Date(Date.now() + 48 * 60 * 60 * 1000),
    },
  });
}

async function main() {
  let categoryId: string | undefined;
  let authorId: string | undefined;
  const claimantIds: string[] = [];

  try {
    const category = await prisma.category.create({
      data: { name: `Concurrency Category ${suffix}` },
    });
    categoryId = category.id;

    const { author, claimants } = await createUsers();
    authorId = author.id;
    claimantIds.push(...claimants.map((user) => user.id));

    console.log(`场景 A：${ROUNDS} 轮，每轮 ${CONCURRENCY} 个请求抢同一条认领`);
    for (let round = 1; round <= ROUNDS; round += 1) {
      const post = await createPost(author.id, category.id, `same-claim-${round}`);
      const claim = await createClaim(post.id, claimants[0].id);

      const results = await Promise.all(
        Array.from({ length: CONCURRENCY }, () => reviewClaim(claim.id, author.id)),
      );
      const successes = results.filter((item) => item.ok).length;
      const codes = results
        .filter((item) => !item.ok)
        .reduce<Record<string, number>>((acc, item) => {
          acc[item.code] = (acc[item.code] ?? 0) + 1;
          return acc;
        }, {});

      console.log(
        `  round ${round}: 成功 ${successes}，其余 ${JSON.stringify(codes)}`,
      );
      assert.equal(successes, 1, `round ${round}: 同一条认领应恰好一个成功`);
      assert.ok(
        results.every(
          (item) => item.ok || ["CLAIM_NOT_PENDING", "POST_NOT_OPEN"].includes(item.code),
        ),
        `round ${round}: 出现死锁或未知错误 ${JSON.stringify(codes)}`,
      );

      await prisma.post.delete({ where: { id: post.id } });
    }

    console.log(`场景 B：${ROUNDS} 轮，每轮同一帖子 10 条认领并发审核`);
    for (let round = 1; round <= ROUNDS; round += 1) {
      const post = await createPost(author.id, category.id, `many-claims-${round}`);
      const claims = [];
      for (const claimantId of claimantIds) {
        claims.push(await createClaim(post.id, claimantId));
      }

      const results = await Promise.all(
        claims.map((claim) => reviewClaim(claim.id, author.id)),
      );
      const successes = results.filter((item) => item.ok).length;
      const codes = results
        .filter((item) => !item.ok)
        .reduce<Record<string, number>>((acc, item) => {
          acc[item.code] = (acc[item.code] ?? 0) + 1;
          return acc;
        }, {});

      const postAfter = await prisma.post.findUniqueOrThrow({
        where: { id: post.id },
        select: { status: true },
      });
      const claimStatuses = await prisma.claim.groupBy({
        by: ["status"],
        where: { postId: post.id },
        _count: { _all: true },
      });

      console.log(
        `  round ${round}: 成功 ${successes}，其余 ${JSON.stringify(codes)}，帖子 ${postAfter.status}，认领 ${claimStatuses
          .map((row) => `${row.status}=${row._count._all}`)
          .join(", ")}`,
      );

      assert.equal(successes, 1, `round ${round}: 同一帖子应恰好一个认领通过`);
      assert.ok(
        results.every(
          (item) => item.ok || ["CLAIM_NOT_PENDING", "POST_NOT_OPEN"].includes(item.code),
        ),
        `round ${round}: 出现死锁或未知错误 ${JSON.stringify(codes)}`,
      );
      assert.equal(postAfter.status, "RESOLVED", `round ${round}: 帖子应标记为已解决`);
      const accepted = claimStatuses.find((row) => row.status === "ACCEPTED")?._count._all ?? 0;
      assert.equal(accepted, 1, `round ${round}: 应恰好一条 ACCEPTED 认领`);

      await prisma.post.delete({ where: { id: post.id } });
    }

    console.log("P5 并发认领实验通过：每轮恰好一个请求成功，未出现死锁或未处理异常");
  } finally {
    if (authorId) {
      await prisma.user.deleteMany({
        where: { id: { in: [authorId, ...claimantIds] } },
      });
    }
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