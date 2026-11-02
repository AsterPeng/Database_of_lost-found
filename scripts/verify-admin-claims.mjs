import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { PrismaClient } from "@prisma/client";

const base = process.env.BASE_URL ?? "http://127.0.0.1:3000";
const prisma = new PrismaClient();
const userIds = [];
const claimIds = [];

async function createUser(role, label) {
  const user = await prisma.user.create({
    data: {
      email: `verify-admin-claims-${label}-${randomBytes(8).toString("hex")}@example.invalid`,
      nickname: `Verify ${label}`,
      passwordHash: "temporary-test-account",
      role,
      profileCompleted: true,
    },
  });
  userIds.push(user.id);
  const token = randomBytes(32).toString("base64url");
  await prisma.session.create({
    data: {
      userId: user.id,
      tokenHash: createHash("sha256").update(token).digest("hex"),
      expiresAt: new Date(Date.now() + 60_000),
    },
  });
  return { id: user.id, cookie: `clfp_session=${token}` };
}

async function get(path, cookie, redirect = "follow") {
  return fetch(base + path, { headers: { cookie }, redirect });
}

function actionFields(html, decision) {
  const form = [...html.matchAll(/<form\b[\s\S]*?<\/form>/g)]
    .map((match) => match[0])
    .find((value) => value.includes(`value="${decision}"`));
  assert.ok(form, `Missing ${decision} form`);
  const fields = new FormData();
  for (const match of form.matchAll(/<input\b[^>]*type="hidden"[^>]*>/g)) {
    const name = match[0].match(/name="([^"]+)"/)?.[1];
    const value = match[0].match(/value="([^"]*)"/)?.[1] ?? "";
    if (name) fields.set(name, value);
  }
  return fields;
}

async function review(path, cookie, fields) {
  return fetch(base + path, {
    method: "POST",
    headers: { cookie, origin: base },
    body: fields,
    redirect: "manual",
  });
}

try {
  const category = await prisma.category.findFirst({ where: { enabled: true } });
  assert.ok(category, "Seed at least one category before running this check");
  const admin = await createUser("ADMIN", "admin");
  const owner = await createUser("USER", "owner");
  const claimant = await createUser("USER", "claimant");

  const makeClaim = async (title, escalated) => {
    const post = await prisma.post.create({
      data: {
        authorId: owner.id,
        type: "LOST",
        title,
        description: "Temporary admin claim verification post",
        categoryId: category.id,
        location: "Library",
        occurredAt: new Date(),
      },
    });
    const claim = await prisma.claim.create({
      data: {
        postId: post.id,
        claimantId: claimant.id,
        message: "Temporary claim message for verification",
        proof: "Distinct item feature known to the claimant",
        contactEncrypted: "test-only-placeholder",
        contactMasked: "test****only",
        escalateAt: new Date(Date.now() + (escalated ? -60_000 : 48 * 3_600_000)),
        escalatedAt: escalated ? new Date() : null,
      },
    });
    claimIds.push(claim.id);
    return { claim, post };
  };

  const early = await makeClaim("VERIFY-OWNER-FIRST", false);
  const overdue = await makeClaim("VERIFY-ADMIN-QUEUE", true);
  const rejectedCase = await makeClaim("VERIFY-ADMIN-REJECT", true);

  const denied = await get("/admin/claims", owner.cookie, "manual");
  assert.ok([302, 303, 307].includes(denied.status), "Regular user reached admin queue");
  const deniedDetail = await get(`/admin/claims/${overdue.claim.id}`, owner.cookie, "manual");
  assert.ok([302, 303, 307].includes(deniedDetail.status), "Regular user reached admin detail");

  const overview = await (await get("/admin", admin.cookie)).text();
  assert.ok(overview.includes("/admin/claims"), "Overview lacks claim queue link");
  const pending = await (await get("/admin/claims", admin.cookie)).text();
  assert.ok(pending.includes(overdue.post.title), "Escalated claim missing from queue");
  assert.ok(!pending.includes(early.post.title), "Early claim appeared in admin queue");
  const all = await (await get("/admin/claims?state=all", admin.cookie)).text();
  assert.ok(all.includes(early.post.title) && all.includes(overdue.post.title), "All records view is incomplete");

  const earlyDetail = await (await get(`/admin/claims/${early.claim.id}`, admin.cookie)).text();
  assert.ok(!earlyDetail.includes('value="ACCEPT"'), "Early claim exposes admin review form");
  const oldLink = await get(`/me/claims/${overdue.claim.id}`, admin.cookie, "manual");
  assert.ok([302, 303, 307].includes(oldLink.status), "Old admin link did not redirect");
  assert.equal(oldLink.headers.get("location"), `/admin/claims/${overdue.claim.id}`);

  const detailPath = `/admin/claims/${overdue.claim.id}`;
  const detail = await (await get(detailPath, admin.cookie)).text();
  const forged = actionFields(detail, "ACCEPT");
  forged.set("claimId", early.claim.id);
  const forgedResult = await review(detailPath, admin.cookie, forged);
  assert.ok(forgedResult.status < 400, `Forged review failed unexpectedly: ${forgedResult.status}`);
  assert.equal((await prisma.claim.findUniqueOrThrow({ where: { id: early.claim.id } })).status, "PENDING");

  const accepted = await review(detailPath, admin.cookie, actionFields(detail, "ACCEPT"));
  assert.ok(accepted.status < 400, `Admin review returned ${accepted.status}`);
  const [claimAfter, postAfter, audit] = await Promise.all([
    prisma.claim.findUniqueOrThrow({ where: { id: overdue.claim.id } }),
    prisma.post.findUniqueOrThrow({ where: { id: overdue.post.id } }),
    prisma.auditLog.findMany({ where: { targetType: "CLAIM", targetId: overdue.claim.id } }),
  ]);
  assert.equal(claimAfter.status, "ACCEPTED");
  assert.equal(claimAfter.reviewerRole, "ADMIN");
  assert.equal(postAfter.status, "RESOLVED");
  assert.equal(audit.length, 1);
  assert.equal(audit[0].action, "CLAIM_REVIEW");
  const queueAfter = await (await get("/admin/claims", admin.cookie)).text();
  assert.ok(!queueAfter.includes(overdue.post.title), "Reviewed claim remained in pending queue");

  const rejectPath = `/admin/claims/${rejectedCase.claim.id}`;
  const rejectDetail = await (await get(rejectPath, admin.cookie)).text();
  const rejected = await review(rejectPath, admin.cookie, actionFields(rejectDetail, "REJECT"));
  assert.ok(rejected.status < 400, `Admin rejection returned ${rejected.status}`);
  const [rejectedClaim, rejectedPost, rejectAudit] = await Promise.all([
    prisma.claim.findUniqueOrThrow({ where: { id: rejectedCase.claim.id } }),
    prisma.post.findUniqueOrThrow({ where: { id: rejectedCase.post.id } }),
    prisma.auditLog.findMany({ where: { targetType: "CLAIM", targetId: rejectedCase.claim.id } }),
  ]);
  assert.equal(rejectedClaim.status, "REJECTED");
  assert.equal(rejectedPost.status, "OPEN");
  assert.equal(rejectAudit.length, 1);
  assert.equal(rejectAudit[0].detail.decision, "REJECT");

  console.log("Admin claim queue, permissions, review, and audit verified.");
} finally {
  await prisma.auditLog.deleteMany({ where: { targetType: "CLAIM", targetId: { in: claimIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.$disconnect();
}
