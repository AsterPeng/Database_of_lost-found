import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { computeStats, statsToCsv } from "../src/lib/stats";

const prisma = new PrismaClient();
const base = process.env.BASE_URL ?? "http://127.0.0.1:3000";
const suffix = randomBytes(5).toString("hex");
const departmentA = `Verify Stats A ${suffix}`;
const departmentB = `Verify Stats B ${suffix}`;
const departmentC = `=1+${suffix}`;
const userIds: string[] = [];
let categoryId: string | undefined;
const now = new Date();
const recent = new Date(now.getTime() - 24 * 60 * 60 * 1000);
const old = new Date(now.getTime() - 20 * 24 * 60 * 60 * 1000);

async function createUser(label: string, department: string, role: "USER" | "ADMIN" = "USER", status: "ACTIVE" | "ARCHIVED" = "ACTIVE") {
  const user = await prisma.user.create({
    data: {
      email: `verify-stats-${label}-${suffix}@example.invalid`,
      nickname: `Verify ${label}`,
      passwordHash: "temporary-test-account",
      department,
      role,
      status,
      profileCompleted: true,
      createdAt: recent,
    },
  });
  userIds.push(user.id);
  return user;
}

async function main() {
try {
  const category = await prisma.category.create({
    data: { name: `Verify, "Stats" ${suffix}`, enabled: true },
  });
  categoryId = category.id;
  const a = await createUser("a", departmentA);
  const b = await createUser("b", departmentB);
  await createUser("c", departmentC);
  await createUser("archived", departmentA, "USER", "ARCHIVED");
  const admin = await createUser("admin", departmentA, "ADMIN");

  const post = async (authorId: string, type: "LOST" | "FOUND", title: string, createdAt: Date, extras = {}) =>
    prisma.post.create({
      data: {
        authorId,
        type,
        title,
        description: "Temporary statistics verification post",
        categoryId: category.id,
        location: "Library",
        occurredAt: createdAt,
        createdAt,
        ...extras,
      },
    });

  const resolved = await post(a.id, "LOST", `VERIFY-RESOLVED-${suffix}`, recent, { status: "RESOLVED", resolvedAt: recent });
  await post(a.id, "LOST", `VERIFY-DOWN-${suffix}`, recent, { takenDownAt: recent });
  const deleted = await post(a.id, "LOST", `VERIFY-DELETED-${suffix}`, recent, { deletedAt: recent });
  const older = await post(a.id, "LOST", `VERIFY-OLD-${suffix}`, old);
  const found = await post(b.id, "FOUND", `VERIFY-FOUND-${suffix}`, recent);

  const match = (lostPostId: string, createdAt: Date) => prisma.match.create({
    data: { lostPostId, foundPostId: found.id, score: 0.8, detail: {}, createdAt },
  });
  await match(resolved.id, recent);
  await match(deleted.id, recent);
  await match(older.id, old);

  const claim = (postId: string, claimantId: string) => prisma.claim.create({
    data: {
      postId,
      claimantId,
      message: "Temporary statistics verification claim",
      proof: "A unique item feature",
      contactEncrypted: "test-only-placeholder",
      contactMasked: "test****only",
      escalateAt: new Date(now.getTime() + 48 * 60 * 60 * 1000),
      createdAt: recent,
    },
  });
  await claim(resolved.id, b.id);
  await claim(deleted.id, b.id);
  await claim(found.id, a.id);

  const statsA = await computeStats("7d", departmentA, now);
  assert.deepEqual(statsA.totals, {
    users: 1,
    newUsers: 2,
    posts: 2,
    resolved: 1,
    matches: 1,
    claims: 2,
    takenDown: 1,
  });
  assert.equal(statsA.recoveryRate, 50);
  assert.deepEqual(statsA.byDepartment.map((row) => [row.department, row.users, row.posts, row.resolved]), [
    [departmentA, 1, 2, 1],
  ]);
  assert.deepEqual(statsA.byCategory.map((row) => [row.category, row.posts, row.resolved]), [
    [category.name, 2, 1],
  ]);

  const statsB = await computeStats("7d", departmentB, now);
  assert.equal(statsB.totals.matches, 1);
  assert.equal(statsB.totals.claims, 2);
  assert.equal(statsB.totals.posts, 1);

  const statsC = await computeStats("7d", departmentC, now);
  assert.equal(statsC.totals.users, 1);
  assert.equal(statsC.totals.posts, 0);
  assert.deepEqual(statsC.byDepartment.map((row) => [row.department, row.users, row.posts]), [
    [departmentC, 1, 0],
  ]);

  const allA = await computeStats("all", departmentA, now);
  assert.equal(allA.totals.posts, 3);
  assert.equal(allA.totals.matches, 2);

  const csvA = statsToCsv(statsA);
  assert.ok(csvA.startsWith("\uFEFF"));
  assert.ok(csvA.includes(`发布量（未删除）,2`));
  assert.ok(csvA.includes(`认领量,2`));
  assert.ok(csvA.includes(`"${category.name.replaceAll('"', '""')}",2,1`));
  const csvC = statsToCsv(statsC);
  assert.ok(csvC.includes(`'${departmentC},1,0,0,0%`));

  const token = randomBytes(32).toString("base64url");
  await prisma.session.create({
    data: {
      userId: admin.id,
      tokenHash: createHash("sha256").update(token).digest("hex"),
      expiresAt: new Date(Date.now() + 60_000),
    },
  });
  const cookie = `clfp_session=${token}`;
  const query = `range=7d&department=${encodeURIComponent(departmentA)}`;
  const page = await fetch(`${base}/admin/stats?${query}`, { headers: { cookie } });
  const html = await page.text();
  assert.equal(page.status, 200);
  assert.ok(html.includes(departmentA) && html.includes("发布量仅排除已删除信息"), JSON.stringify({
    hasDepartment: html.includes(departmentA),
    hasScopeNote: html.includes("发布量仅排除已删除信息"),
    title: html.match(/<title>(.*?)<\/title>/)?.[1],
  }));

  const download = await fetch(`${base}/admin/stats/export?${query}`, { headers: { cookie } });
  assert.equal(download.status, 200);
  const exported = await download.text();
  assert.ok(exported.includes("发布量（未删除）,2") && exported.includes("认领量,2"));

  console.log("Statistics filters, cohorts, department rows, and CSV verified.");
} finally {
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  if (categoryId) await prisma.category.delete({ where: { id: categoryId } });
  await prisma.$disconnect();
}
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
