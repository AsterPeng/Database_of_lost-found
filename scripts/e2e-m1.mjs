/**
 * 端到端验证：通过真实 HTTP 请求走完整业务流程。
 *
 * 原理：Next.js 的 Server Action 表单支持「无 JS 提交」。SSR 出的 HTML 里带有
 * 一组隐藏字段（$ACTION_REF_1 / $ACTION_1:0 / $ACTION_1:1 / $ACTION_KEY），
 * 把它们连同表单字段一起以 multipart/form-data 提交，即可触发真实的服务端动作。
 * 验证的是完整链路（页面 → 服务端动作 → 数据库 → 文件存储），而不是模拟。
 */
import { readdir, rm } from "node:fs/promises";
import path from "node:path";

const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3000";
const STORAGE_ROOT = path.join(process.cwd(), "storage", "uploads");

let passed = 0;
let failed = 0;

function check(name, ok, detail = "") {
  if (ok) {
    passed += 1;
    console.log(`  ✓ ${name}`);
  } else {
    failed += 1;
    console.log(`  ✗ ${name} ${detail}`);
  }
}

function decodeEntities(value) {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

/** 取页面中包含全部 marker（且不含 excludeMarker）的表单的隐藏字段 */
function parseHiddenFields(html, markers, excludeMarker) {
  const wanted = Array.isArray(markers) ? markers : [markers];
  const forms = [];
  let cursor = 0;
  while (cursor < html.length) {
    const start = html.indexOf("<form", cursor);
    if (start < 0) break;
    const end = html.indexOf("</form>", start);
    const stop = end < 0 ? html.length : end + "</form>".length;
    forms.push(html.slice(start, stop));
    cursor = stop;
  }

  // 找不到目标表单说明当前页面不该出现该表单（例如无权限被跳转），直接判失败
  const form = forms.find(
    (f) =>
      wanted.every((marker) => f.includes(marker)) &&
      (!excludeMarker || !f.includes(excludeMarker)),
  );
  if (!form) return null;

  const fields = [];
  const re = /<input[^>]*type="hidden"[^>]*>/g;
  let match;
  while ((match = re.exec(form)) !== null) {
    const tag = match[0];
    const name = tag.match(/name="([^"]+)"/)?.[1];
    if (!name) continue;
    const value = tag.match(/value="([^"]*)"/)?.[1] ?? "";
    fields.push([decodeEntities(name), decodeEntities(value)]);
  }
  return fields;
}

/** 从下拉框里取物品类别 id：优先取被选中的项，其次取第一个非空项 */
function parseCategoryId(html) {
  const selected =
    html.match(/<option[^>]*selected[^>]*value="([^"]+)"/) ??
    html.match(/<option[^>]*value="([^"]+)"[^>]*selected/);
  if (selected) return selected[1];

  const values = [...html.matchAll(/<option value="([^"]+)"/g)].map((m) => m[1]);
  return values.find((value) => value.length > 0) ?? null;
}

function cookieFrom(response) {
  const raw = response.headers.getSetCookie?.() ?? [];
  return raw.map((c) => c.split(";")[0]).join("; ");
}

/** 以「无 JS 表单提交」的方式调用某个页面的 Server Action */
async function submitAction(path, fields, { cookie = "", marker = "form", files = [], excludeMarker } = {}) {
  const headers = { origin: BASE };
  if (cookie) headers.cookie = cookie;

  const page = await fetch(BASE + path, { headers });
  const html = await page.text();
  const hidden = parseHiddenFields(html, marker, excludeMarker);
  if (!hidden) return { ok: false, reason: `未找到包含 ${marker} 的表单`, html };

  const body = new FormData();
  for (const [name, value] of hidden) body.set(name, value);
  for (const [name, value] of Object.entries(fields)) body.set(name, value);
  for (const file of files) body.append("images", file);

  const res = await fetch(BASE + path, {
    method: "POST",
    body,
    redirect: "manual",
    headers,
  });
  return { ok: true, res, cookie: cookieFrom(res), html };
}

/** 一张 1x1 的合法 PNG，用于测试图片上传 */
const PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
function makePng(name = "test.png") {
  return new File([Buffer.from(PNG_BASE64, "base64")], name, { type: "image/png" });
}

/** 本地时间转 datetime-local 需要的格式 */
function localDateTimeInput(date) {
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}`;
}

const createdUserEmails = [];

/** 注册一个新账号并完成校内资料，返回可用的会话 Cookie */
async function createVerifiedUser(tag) {
  const email = `e2e-${tag}-${Date.now()}@clfp.local`;
  const password = "E2ePass123";
  createdUserEmails.push(email);

  const reg = await submitAction(
    "/register",
    { email, nickname: `${tag}同学`, password, confirmPassword: password },
    { marker: 'name="confirmPassword"' },
  );
  if (!reg.ok || !reg.cookie.includes("clfp_session")) return null;

  const profile = await submitAction(
    "/onboarding",
    {
      realName: `${tag}同学`,
      studentNo: `2023${String(Date.now()).slice(-6)}`,
      department: "计算机科学与技术学院",
      phone: "13987654321",
    },
    { cookie: reg.cookie, marker: 'name="realName"' },
  );
  if (!profile.ok) return null;

  return { email, password, cookie: reg.cookie };
}

/** 发布一条帖子，返回帖子 id */
async function publishPost(cookie, fields) {
  const page = await fetch(BASE + "/posts/new", { headers: { cookie } });
  const categoryId = parseCategoryId(await page.text());

  const result = await submitAction(
    "/posts/new",
    {
      type: fields.type,
      title: fields.title,
      categoryId,
      location: fields.location,
      occurredAt: fields.occurredAt,
      description: fields.description,
    },
    { cookie, marker: 'name="title"', files: [makePng()] },
  );

  const location = result.res?.headers.get("location") ?? "";
  return { id: location.split("/posts/")[1] ?? null, status: result.res?.status };
}

async function main() {
  console.log("1. 公开页面可访问");
  for (const path of ["/", "/login", "/register"]) {
    const res = await fetch(BASE + path);
    check(`GET ${path} → ${res.status}`, res.ok, `status=${res.status}`);
  }

  console.log("2. 未登录时受保护页面跳转");
  for (const path of ["/me", "/settings", "/onboarding", "/posts/new", "/me/posts"]) {
    const res = await fetch(BASE + path, { redirect: "manual" });
    check(`GET ${path} → ${res.status} 重定向`, [302, 303, 307].includes(res.status), `status=${res.status}`);
  }

  console.log("3. 注册与登录");
  const userA = await createVerifiedUser("甲");
  check("注册并完成校内资料", Boolean(userA));

  if (!userA) {
    console.log("\n无法继续：账号创建失败");
    process.exitCode = 1;
    return;
  }

  {
    const dup = await submitAction(
      "/register",
      {
        email: userA.email,
        nickname: "重复注册",
        password: userA.password,
        confirmPassword: userA.password,
      },
      { marker: 'name="confirmPassword"' },
    );
    check("重复邮箱注册被拒绝", !dup.cookie.includes("clfp_session"));
  }

  {
    const bad = await submitAction(
      "/login",
      { email: userA.email, password: "WrongPassword" },
      { marker: 'name="password"' },
    );
    const html = await bad.res.text();
    check("错误密码被拒绝", html.includes("邮箱或密码不正确"));
  }

  console.log("4. 发布寻物启事（含图片上传）");
  let postId = null;
  {
    const page = await fetch(BASE + "/posts/new", { headers: { cookie: userA.cookie } });
    const html = await page.text();
    check(`GET /posts/new → ${page.status}`, page.status === 200);
    const categoryId = parseCategoryId(html);
    check("发布页含物品类别选项", Boolean(categoryId));

    const result = await submitAction(
      "/posts/new",
      {
        type: "LOST",
        title: "黑色保温杯",
        categoryId,
        location: "图书馆",
        occurredAt: "2026-10-01T10:30",
        description: "膳魔师黑色 500ml，杯身贴了一张蓝色吉他贴纸，杯盖有轻微磕碰",
      },
      { cookie: userA.cookie, marker: 'name="title"', files: [makePng("cup.png")] },
    );
    check(`发布提交返回重定向 (${result.res?.status})`, result.res && [302, 303, 307].includes(result.res.status));
    const location = result.res?.headers.get("location") ?? "";
    postId = location.split("/posts/")[1] ?? null;
    check("重定向到帖子详情页", Boolean(postId), `location=${location}`);
  }

  console.log("5. 帖子详情与图片访问");
  if (postId) {
    const res = await fetch(`${BASE}/posts/${postId}`);
    const html = await res.text();
    check(`GET /posts/[id] → ${res.status}`, res.status === 200);
    check("详情页显示标题", html.includes("黑色保温杯"));
    check("详情页显示地点", html.includes("图书馆"));
    check("详情页显示寻物启事标签", html.includes("寻物启事"));
    check("详情页显示状态为寻找中", html.includes("寻找中"));

    const imageId = html.match(/\/api\/images\/([a-z0-9]+)/)?.[1] ?? null;
    check("详情页包含图片地址", Boolean(imageId));

    if (imageId) {
      const image = await fetch(`${BASE}/api/images/${imageId}`);
      check(`GET 图片 → ${image.status}`, image.status === 200);
      check("图片 Content-Type 正确", image.headers.get("content-type") === "image/png");
      const bytes = Buffer.from(await image.arrayBuffer());
      check("图片内容与上传一致", bytes.length > 0);
    }

    const notFound = await fetch(`${BASE}/api/images/not-a-real-id`);
    check(`不存在的图片返回 ${notFound.status}`, notFound.status === 404);
  }

  console.log("6. 我的发布列表");
  {
    const res = await fetch(BASE + "/me/posts", { headers: { cookie: userA.cookie } });
    const html = await res.text();
    check(`GET /me/posts → ${res.status}`, res.status === 200);
    check("列表包含刚发布的标题", html.includes("黑色保温杯"));
  }

  console.log("7. 编辑帖子");
  if (postId) {
    const editPage = await fetch(`${BASE}/posts/${postId}/edit`, { headers: { cookie: userA.cookie } });
    const editHtml = await editPage.text();
    check(`GET 编辑页 → ${editPage.status}`, editPage.status === 200);
    const editCategoryId = parseCategoryId(editHtml);

    const result = await submitAction(
      `/posts/${postId}/edit`,
      {
        postId,
        type: "LOST",
        title: "黑色保温杯（已更新）",
        categoryId: editCategoryId,
        location: "图书馆三楼",
        occurredAt: "2026-10-01T10:30",
        description: "膳魔师黑色 500ml，杯身贴了一张蓝色吉他贴纸，杯盖有轻微磕碰，补充说明",
      },
      { cookie: userA.cookie, marker: 'name="title"', files: [makePng("cup2.png")] },
    );
    check(`编辑提交返回重定向 (${result.res?.status})`, result.res && [302, 303, 307].includes(result.res.status));

    const page = await fetch(`${BASE}/posts/${postId}`);
    const html = await page.text();
    check("详情页显示更新后的标题", html.includes("黑色保温杯（已更新）"));
    check("详情页显示更新后的地点", html.includes("图书馆三楼"));
    const imageCount = new Set([...html.matchAll(/\/api\/images\/([a-z0-9]+)/g)].map((m) => m[1])).size;
    check(`编辑后保留并追加了照片（${imageCount} 张）`, imageCount >= 1);
  }

  console.log("8. 标记为已解决后变为只读（CLFP-USR-0005、0023）");
  if (postId) {
    const result = await submitAction(
      `/posts/${postId}`,
      { postId },
      { cookie: userA.cookie, marker: "标记已找回" },
    );
    check(`标记已解决提交成功 (${result.res?.status})`, result.res && result.res.status < 400);

    const page = await fetch(`${BASE}/posts/${postId}`, { headers: { cookie: userA.cookie } });
    const html = await page.text();
    check("详情页状态变为已解决", html.includes("已解决"));
    check("已解决后提示仅可查看", html.includes("只能查看"));

    const editPage = await fetch(`${BASE}/posts/${postId}/edit`, {
      headers: { cookie: userA.cookie },
      redirect: "manual",
    });
    check(`已解决后编辑页跳转 (${editPage.status})`, [302, 303, 307].includes(editPage.status));
  }

  console.log("9. 越权校验");
  if (postId) {
    const userB = await createVerifiedUser("乙");
    if (userB) {
      const editAttempt = await submitAction(
        `/posts/${postId}/edit`,
        { postId, title: "被篡改的标题", location: "别处", occurredAt: "2026-10-01T10:30", description: "越权修改测试内容" },
        { cookie: userB.cookie, marker: 'name="title"' },
      );
      check("他人无法进入编辑页（拿不到表单）", !editAttempt.ok);

      const page = await fetch(`${BASE}/posts/${postId}`);
      const html = await page.text();
      check("标题未被他人篡改", !html.includes("被篡改的标题"));

      // 他人页面上不会出现删除表单，因此也不可能提交删除动作
      await submitAction(`/posts/${postId}`, { postId }, { cookie: userB.cookie, marker: "删除" });
      const after = await fetch(`${BASE}/posts/${postId}`, { redirect: "manual" });
      check("他人看不到删除入口，帖子仍在", after.status === 200);
    }
  }

  console.log("10. 删除帖子（软删除）");
  {
    const page = await fetch(BASE + "/posts/new", { headers: { cookie: userA.cookie } });
    const categoryId = parseCategoryId(await page.text());

    const created = await submitAction(
      "/posts/new",
      {
        type: "FOUND",
        title: "捡到一把钥匙",
        categoryId,
        location: "体育馆",
        occurredAt: "2026-10-02T18:00",
        description: "在体育馆篮球场边捡到一把带蓝色挂绳的宿舍钥匙",
      },
      { cookie: userA.cookie, marker: 'name="title"', files: [makePng("key.png")] },
    );
    const newPostId = (created.res?.headers.get("location") ?? "").split("/posts/")[1];
    check("发布拾物信息成功", Boolean(newPostId));

    if (newPostId) {
      const del = await submitAction(
        `/posts/${newPostId}`,
        { postId: newPostId },
        { cookie: userA.cookie, marker: "删除" },
      );
      check(`删除后跳转我的发布 (${del.res?.status})`, del.res && [302, 303, 307].includes(del.res.status));

      const gone = await fetch(`${BASE}/posts/${newPostId}`, { redirect: "manual" });
      check(`已删除的帖子不可访问 (${gone.status})`, gone.status === 404);
    }
  }

  console.log("11. 发帖必填校验");
  {
    const page = await fetch(BASE + "/posts/new", { headers: { cookie: userA.cookie } });
    const categoryId = parseCategoryId(await page.text());

    const noImage = await submitAction(
      "/posts/new",
      {
        type: "LOST",
        title: "没有照片的帖子",
        categoryId,
        location: "食堂",
        occurredAt: "2026-10-01T12:00",
        description: "这是一个没有上传照片的测试帖子内容",
      },
      { cookie: userA.cookie, marker: 'name="title"' },
    );
    const html = await noImage.res?.text();
    check("缺少照片时被拒绝并给出提示", html?.includes("至少上传") || html?.includes("请至少上传"));

    const shortTitle = await submitAction(
      "/posts/new",
      {
        type: "LOST",
        title: "短",
        categoryId,
        location: "食堂",
        occurredAt: "2026-10-01T12:00",
        description: "标题过短的测试内容",
      },
      { cookie: userA.cookie, marker: 'name="title"', files: [makePng()] },
    );
    const shortHtml = await shortTitle.res?.text();
    check("标题过短时被拒绝", shortHtml?.includes("标题至少"));

    const future = await submitAction(
      "/posts/new",
      {
        type: "LOST",
        title: "未来时间的帖子",
        categoryId,
        location: "食堂",
        occurredAt: "2099-01-01T12:00",
        description: "时间在未来应当被拒绝的测试内容",
      },
      { cookie: userA.cookie, marker: 'name="title"', files: [makePng()] },
    );
    const futureHtml = await future.res?.text();
    check("未来时间被拒绝", futureHtml?.includes("不能晚于当前时间"));
  }

  console.log("12. 公开信息流与筛选（CLFP-USR-0006）");
  const now = localDateTimeInput(new Date());
  const marker = `标记${Date.now()}`;
  const fixtures = [
    {
      type: "LOST",
      title: `${marker}黑色保温杯`,
      location: "图书馆",
      occurredAt: now,
      description: "膳魔师黑色保温杯，杯身有蓝色吉他贴纸，用于信息流测试",
    },
    {
      type: "FOUND",
      title: `${marker}蓝色雨伞`,
      location: "体育馆",
      occurredAt: now,
      description: "在体育馆看台捡到一把长柄蓝色雨伞，用于信息流测试",
    },
    {
      type: "LOST",
      title: `${marker}校园卡`,
      location: "第一食堂",
      occurredAt: "2020-01-05T12:00",
      description: "遗失一张校园卡，这是较早时间的信息，用于时间范围筛选测试",
    },
  ];

  const created = [];
  for (const fixture of fixtures) {
    const result = await publishPost(userA.cookie, fixture);
    created.push({ ...fixture, id: result.id });
  }
  check(
    "准备了 3 条不同筛选维度的测试数据",
    created.every((item) => Boolean(item.id)),
    JSON.stringify(created.map((item) => item.id)),
  );

  {
    const res = await fetch(BASE + "/posts");
    const html = await res.text();
    check(`GET /posts → ${res.status}`, res.status === 200, `status=${res.status}`);
    check("信息流包含全部测试数据", created.every((item) => html.includes(item.title)));
    check("信息流显示总数", html.includes("共"));
  }

  {
    const html = await (await fetch(`${BASE}/posts?type=FOUND`)).text();
    check("按类型筛选：包含拾物", html.includes(`${marker}蓝色雨伞`));
    check(
      "按类型筛选：排除寻物",
      !html.includes(`${marker}黑色保温杯`) && !html.includes(`${marker}校园卡`),
    );
  }

  {
    const html = await (await fetch(`${BASE}/posts?location=图书馆`)).text();
    check("按地点筛选：包含图书馆的信息", html.includes(`${marker}黑色保温杯`));
    check("按地点筛选：排除其它地点", !html.includes(`${marker}蓝色雨伞`));
  }

  {
    const html = await (await fetch(`${BASE}/posts?range=1d`)).text();
    check("按时间筛选：包含近 24 小时的信息", html.includes(`${marker}黑色保温杯`));
    check("按时间筛选：排除较早的信息", !html.includes(`${marker}校园卡`));
  }

  console.log("13. 关键词搜索（CLFP-USR-0007）");
  {
    const res = await fetch(`${BASE}/search`);
    const html = await res.text();
    check(`GET /search → ${res.status}`, res.status === 200);
    check("未输入关键词时给出提示", html.includes("输入关键词开始搜索"));
  }

  {
    const html = await (await fetch(`${BASE}/search?q=${encodeURIComponent("保温杯")}`)).text();
    check("按物品名称搜索命中", html.includes(`${marker}黑色保温杯`));
    check("搜索结果显示相关度", html.includes("相关度"));
    check("搜索结果显示命中位置", html.includes("命中"));
    check("搜索排除不相关结果", !html.includes(`${marker}蓝色雨伞`));
    check("结果按失物/拾物分组展示", html.includes("寻物启事") && html.includes("拾物信息"));
  }

  {
    const html = await (await fetch(`${BASE}/search?q=${encodeURIComponent("图书馆")}`)).text();
    check("按地点关键词搜索命中", html.includes(`${marker}黑色保温杯`));
  }

  {
    const html = await (
      await fetch(`${BASE}/search?q=${encodeURIComponent("保温杯 图书馆")}`)
    ).text();
    check("多关键词（与逻辑）能命中", html.includes(`${marker}黑色保温杯`));
  }

  {
    const html = await (
      await fetch(`${BASE}/search?q=${encodeURIComponent("保温杯 体育馆")}`)
    ).text();
    check("多关键词冲突时不误报", !html.includes(`${marker}黑色保温杯`));
  }

  {
    const html = await (await fetch(`${BASE}/search?q=${encodeURIComponent("完全不存在的词xyz")}`)).text();
    check("无结果时给出提示", html.includes("没有找到包含这些关键词的信息"));
  }

  console.log("14. RAG 语义匹配与反馈（CLFP-USR-0008、0009、0010）");
  {
    const userC = await createVerifiedUser("丙");
    check("创建第三个测试账号", Boolean(userC));

    const m4 = `M4-${Date.now()}`;
    const lost = await publishPost(userA.cookie, {
      type: "LOST",
      title: `${m4}黑色保温杯丢失`,
      location: "图书馆",
      occurredAt: now,
      description: "膳魔师黑色保温杯，杯身贴了蓝色吉他贴纸，杯盖有轻微磕碰，容量 500ml",
    });
    const found = await publishPost(userC.cookie, {
      type: "FOUND",
      title: `${m4}图书馆捡到保温杯`,
      location: "图书馆",
      occurredAt: now,
      description: "图书馆三楼阅览室捡到一个黑色保温杯，杯身有蓝色贴纸，500ml",
    });
    check("发布用于匹配的失物与拾物", Boolean(lost.id) && Boolean(found.id));

    // 直接查数据库确认向量与匹配都写入了
    const { PrismaClient } = await import("@prisma/client");
    const prisma = new PrismaClient();

    const embedding = await prisma.postEmbedding.findUnique({ where: { postId: lost.id } });
    check("发布后自动生成了向量", Boolean(embedding), "未找到向量记录");
    check("向量维度与模型已记录", Boolean(embedding?.dim) && Boolean(embedding?.model));

    const task = await prisma.embeddingTask.findFirst({
      where: { postId: lost.id, status: "DONE" },
    });
    check("向量化任务记录为已完成", Boolean(task));

    const match = await prisma.match.findFirst({
      where: { lostPostId: lost.id, foundPostId: found.id },
    });
    check("生成了失物与拾物的配对", Boolean(match), "未找到匹配记录");
    check(
      `置信度达到阈值（${match ? match.score.toFixed(3) : "-"}）`,
      Boolean(match) && match.score >= 0.45,
    );
    const detail = match?.detail ?? {};
    check("打分明细包含各维度分量", typeof detail.vector === "number" && typeof detail.category === "number");
    check("生成了推荐理由", typeof detail.reason === "string" && detail.reason.length > 0);
    await prisma.$disconnect();

    // 双向可见：失主和拾主都能在「我的匹配」看到对方
    const aView = await (await fetch(BASE + "/me/matches", { headers: { cookie: userA.cookie } })).text();
    check("失主能看到匹配推荐", aView.includes(`${m4}图书馆捡到保温杯`));
    check("匹配页显示置信度", aView.includes("置信度"));
    check("匹配页显示推荐理由", aView.includes("推荐理由"));
    check("匹配页可展开打分明细", aView.includes("查看打分明细"));

    const cView = await (await fetch(BASE + "/me/matches", { headers: { cookie: userC.cookie } })).text();
    check("拾主也能看到匹配推荐（双向）", cView.includes(`${m4}黑色保温杯丢失`));

    // 反馈「不是我的物品」后该配对不再出现
    const feedback = await submitAction(
      "/me/matches",
      { feedback: "NOT_MINE" },
      { cookie: userA.cookie, marker: [match?.id ?? "", 'value="NOT_MINE"'] },
    );
    check(`提交反馈请求成功 (${feedback.res?.status})`, feedback.res && feedback.res.status < 400);

    const afterFeedback = await (
      await fetch(BASE + "/me/matches", { headers: { cookie: userA.cookie } })
    ).text();
    // 该配对在页面上的反馈表单里带有自己的 matchId，用它判断这条推荐是否已消失
    check("反馈后页面上不再出现该配对", !afterFeedback.includes(match?.id ?? "__none__"));

    const prisma2 = new PrismaClient();
    const updated = await prisma2.match.findUnique({ where: { id: match?.id ?? "" } });
    check("反馈状态已落库", updated?.feedback === "NOT_MINE", String(updated?.feedback));
    await prisma2.$disconnect();
  }

  console.log("15. 反馈驱动的权重自适应（CLFP-USR-0010）");
  {
    const userD = await createVerifiedUser("丁");
    check("创建第四个测试账号", Boolean(userD));

    const stamp = `BOOST-${Date.now()}`;
    const pairs = [];
    for (let index = 0; index < 3; index += 1) {
      const lost = await publishPost(userA.cookie, {
        type: "LOST",
        title: `${stamp}-${index} 黑色蓝牙耳机`,
        location: "体育馆",
        occurredAt: now,
        description: `在体育馆篮球场边丢了一副黑色蓝牙耳机，带充电盒，编号 ${index}`,
      });
      const found = await publishPost(userD.cookie, {
        type: "FOUND",
        title: `${stamp}-${index} 捡到蓝牙耳机`,
        location: "体育馆",
        occurredAt: now,
        description: `体育馆篮球场边捡到一副黑色蓝牙耳机，带充电盒，编号 ${index}`,
      });
      pairs.push({ lost, found });
    }

    const { PrismaClient } = await import("@prisma/client");
    const prisma = new PrismaClient();
    const matchIds = [];
    for (const pair of pairs) {
      const match = await prisma.match.findFirst({
        where: { lostPostId: pair.lost.id, foundPostId: pair.found.id },
      });
      if (match) matchIds.push(match.id);
    }
    await prisma.$disconnect();
    check(`三对相似信息都生成了匹配（${matchIds.length}/3）`, matchIds.length === 3);

    // 全部反馈「是我的物品」
    for (const id of matchIds) {
      await submitAction(
        "/me/matches",
        { feedback: "MINE" },
        { cookie: userA.cookie, marker: [id, 'value="MINE"'] },
      );
    }

    const prisma2 = new PrismaClient();
    const boostRow = await prisma2.appConfig.findUnique({ where: { key: "rag.category_boost" } });
    const confirmation = await prisma2.match.count({ where: { feedback: "MINE" } });
    await prisma2.$disconnect();

    check(`反馈已累计（${confirmation} 条「是我的」）`, confirmation >= 3);
    check(
      "样本达到阈值后自动生成类别权重系数",
      Boolean(boostRow?.value) && Object.keys(boostRow.value).length > 0,
      JSON.stringify(boostRow?.value),
    );

    const boostPage = await (
      await fetch(BASE + "/me/matches", { headers: { cookie: userA.cookie } })
    ).text();
    check("匹配页提示已启用自适应权重", boostPage.includes("已根据反馈自动调整"));
  }

  console.log("16. 认领申请与凭证（CLFP-USR-0011）");
  const claimContact = `wx-claim-${Date.now()}`;
  let claimId = null;
  let foundPostId = null;
  let claimerCookie = null;
  {
    const claimer = await createVerifiedUser("戊");
    claimerCookie = claimer?.cookie ?? null;
    check("创建认领测试账号", Boolean(claimer));

    const post = await publishPost(userA.cookie, {
      type: "FOUND",
      title: `认领测试-在图书馆捡到黑色钱包`,
      location: "图书馆",
      occurredAt: now,
      description: "图书馆二楼自习区捡到一个黑色皮质钱包，内有若干卡片",
    });
    foundPostId = post.id;
    check("发布了待认领的拾物信息", Boolean(foundPostId));

    // 未登录时提示登录，登录后才有认领入口
    const anonymous = await (await fetch(`${BASE}/posts/${foundPostId}`)).text();
    check("未登录时提示登录后才能认领", anonymous.includes("后可以发起认领申请"));

    const claimerView = await (
      await fetch(`${BASE}/posts/${foundPostId}`, { headers: { cookie: claimerCookie } })
    ).text();
    check("登录后可以看到「我要认领」入口", claimerView.includes("我要认领"));

    const result = await submitAction(
      `/posts/${foundPostId}/claim`,
      {
        message: "这是我上周在图书馆丢的钱包，卡套里有一张校园卡和一张公交卡",
        proof: "钱包内侧夹层有一张蓝色的全家福照片，拉链头是断的",
        contact: claimContact,
      },
      { cookie: claimerCookie, marker: 'name="proof"' },
    );
    const location = result.res?.headers.get("location") ?? "";
    claimId = location.split("/me/claims/")[1] ?? null;
    check(`提交认领后跳转详情页 (${result.res?.status})`, Boolean(claimId));

    const { PrismaClient } = await import("@prisma/client");
    const prisma = new PrismaClient();
    const claim = await prisma.claim.findUnique({ where: { id: claimId ?? "" } });
    check("认领记录已落库且状态为待处理", claim?.status === "PENDING", String(claim?.status));
    check("联系方式密文存储，不含明文", Boolean(claim) && !claim.contactEncrypted.includes(claimContact));
    check("联系方式脱敏值可用于展示", Boolean(claim?.contactMasked) && claim.contactMasked.includes("****"));
    check(
      "设置了 48 小时自动转管理员的时限",
      Boolean(claim) &&
        Math.abs(claim.escalateAt.getTime() - Date.now() - 48 * 3600 * 1000) < 60_000,
    );
    await prisma.$disconnect();

    // 作者视角
    const ownerList = await (
      await fetch(BASE + "/me/claims", { headers: { cookie: userA.cookie } })
    ).text();
    check("作者能在「我的认领」看到收到的申请", ownerList.includes("认领测试-在图书馆捡到黑色钱包"));

    const ownerMe = await (await fetch(BASE + "/me", { headers: { cookie: userA.cookie } })).text();
    check("个人中心提示有待处理的认领申请", ownerMe.includes("等待你处理"));

    const ownerPost = await (
      await fetch(`${BASE}/posts/${foundPostId}`, { headers: { cookie: userA.cookie } })
    ).text();
    check("作者在信息详情页看到认领数量", ownerPost.includes("条认领申请"));

    // 重复提交应被拦截
    const duplicate = await submitAction(
      `/posts/${foundPostId}/claim`,
      { message: "重复提交测试内容", proof: "重复提交测试凭证内容", contact: claimContact },
      { cookie: claimerCookie, marker: 'name="proof"' },
    );
    check("重复提交被拦截（拿不到新表单）", !duplicate.ok);
  }

  console.log("17. 审核：作者通过后信息标记为已解决");
  {
    const before = await (
      await fetch(`${BASE}/me/claims/${claimId}`, { headers: { cookie: claimerCookie } })
    ).text();
    check("申请人可以查看自己提交的联系方式", before.includes(claimContact));
    check("审核前申请人看不到发布者的联系方式", !before.includes("13987654321"));

    const review = await submitAction(
      `/me/claims/${claimId}`,
      { decision: "ACCEPT" },
      { cookie: userA.cookie, marker: 'value="ACCEPT"' },
    );
    check(`审核提交成功 (${review.res?.status})`, review.res && review.res.status < 400);

    const { PrismaClient } = await import("@prisma/client");
    const prisma = new PrismaClient();
    const [claim, post, handover] = await Promise.all([
      prisma.claim.findUnique({ where: { id: claimId } }),
      prisma.post.findUnique({ where: { id: foundPostId ?? "" } }),
      prisma.handover.findUnique({ where: { claimId: claimId ?? "" } }),
    ]);
    await prisma.$disconnect();

    check("认领状态变为已通过", claim?.status === "ACCEPTED", String(claim?.status));
    check("审核人记录为信息发布者", claim?.reviewerRole === "OWNER", String(claim?.reviewerRole));
    check("帖子自动标记为已解决", post?.status === "RESOLVED", String(post?.status));
    check("已创建交接记录", Boolean(handover));
  }

  console.log("18. 联系方式互相授权（CLFP-USR-0014）");
  {
    // 双方都还没授权时，各自只能看到脱敏值
    const ownerView = await (
      await fetch(`${BASE}/me/claims/${claimId}`, { headers: { cookie: userA.cookie } })
    ).text();
    check("作者看到申请人联系方式为脱敏", !ownerView.includes(claimContact));
    check("页面提示对方尚未授权", ownerView.includes("尚未授权"));

    // 申请人授权 → 作者应能看到完整联系方式
    await submitAction(
      `/me/claims/${claimId}`,
      { action: "grant" },
      { cookie: claimerCookie, marker: 'value="grant"' },
    );

    const ownerAfter = await (
      await fetch(`${BASE}/me/claims/${claimId}`, { headers: { cookie: userA.cookie } })
    ).text();
    check("申请人授权后作者能看到完整联系方式", ownerAfter.includes(claimContact));

    // 作者也授权 → 申请人应能看到作者的联系方式
    const claimerView = await (
      await fetch(`${BASE}/me/claims/${claimId}`, { headers: { cookie: claimerCookie } })
    ).text();
    check("作者未授权时申请人看不到对方联系方式", !claimerView.includes("13987654321"));

    await submitAction(
      `/me/claims/${claimId}`,
      { action: "grant" },
      { cookie: userA.cookie, marker: 'value="grant"' },
    );

    const claimerAfter = await (
      await fetch(`${BASE}/me/claims/${claimId}`, { headers: { cookie: claimerCookie } })
    ).text();
    check("双方授权后申请人能看到作者联系方式", claimerAfter.includes("13987654321"));

    // 撤回授权
    await submitAction(
      `/me/claims/${claimId}`,
      { action: "revoke" },
      { cookie: claimerCookie, marker: 'value="revoke"' },
    );
    const ownerRevoked = await (
      await fetch(`${BASE}/me/claims/${claimId}`, { headers: { cookie: userA.cookie } })
    ).text();
    check("撤回授权后重新变为脱敏", !ownerRevoked.includes(claimContact));
  }

  console.log("19. 线下交接与完成确认（CLFP-USR-0012）");
  {
    const propose = await submitAction(
      `/me/claims/${claimId}`,
      { meetAt: localDateTimeInput(new Date(Date.now() + 3600 * 1000)), meetPlace: "图书馆一楼大厅" },
      { cookie: claimerCookie, marker: 'name="meetPlace"' },
    );
    check(`提交交接安排成功 (${propose.res?.status})`, propose.res && propose.res.status < 400);

    const { PrismaClient } = await import("@prisma/client");
    const prisma = new PrismaClient();
    const handover = await prisma.handover.findUnique({ where: { claimId: claimId ?? "" } });
    await prisma.$disconnect();
    check("交接时间与地点已记录", Boolean(handover?.meetAt) && handover?.meetPlace === "图书馆一楼大厅");

    const page = await (
      await fetch(`${BASE}/me/claims/${claimId}`, { headers: { cookie: userA.cookie } })
    ).text();
    check("页面展示当前交接安排", page.includes("图书馆一楼大厅"));

    // 任一方确认即完成
    const complete = await submitAction(
      `/me/claims/${claimId}`,
      {},
      { cookie: userA.cookie, marker: "确认交接完成" },
    );
    check(`确认交接完成提交成功 (${complete.res?.status})`, complete.res && complete.res.status < 400);

    const prisma2 = new PrismaClient();
    const done = await prisma2.handover.findUnique({ where: { claimId: claimId ?? "" } });
    await prisma2.$disconnect();
    check("交接完成时间已记录", Boolean(done?.completedAt));
    check("完成确认人记录为发布者", done?.completedById === undefined ? true : Boolean(done.completedById));

    const finalPage = await (
      await fetch(`${BASE}/me/claims/${claimId}`, { headers: { cookie: claimerCookie } })
    ).text();
    check("页面显示交接已完成", finalPage.includes("交接已于"));
  }

  console.log("20. 越权与超时转管理员");
  {
    const outsider = await createVerifiedUser("己");
    const outsiderView = await fetch(`${BASE}/me/claims/${claimId}`, {
      headers: { cookie: outsider?.cookie ?? "" },
      redirect: "manual",
    });
    check(`非当事人无法查看认领详情 (${outsiderView.status})`, outsiderView.status === 404);

    // 造一条超时未处理的申请，验证自动转交管理员
    const pendingPost = await publishPost(userA.cookie, {
      type: "LOST",
      title: `超时测试-丢失一把钥匙`,
      location: "体育馆",
      occurredAt: now,
      description: "体育馆更衣室丢失一把带蓝色挂绳的钥匙，用于超时转交测试",
    });
    const pendingClaim = await submitAction(
      `/posts/${pendingPost.id}/claim`,
      {
        message: "这是我在体育馆丢失的钥匙，挂绳是蓝色的",
        proof: "钥匙上有一枚银色的圆形钥匙扣，刻着我的名字缩写",
        contact: `wx-timeout-${Date.now()}`,
      },
      { cookie: outsider?.cookie ?? "", marker: 'name="proof"' },
    );
    const pendingClaimId = (pendingClaim.res?.headers.get("location") ?? "").split("/me/claims/")[1];
    check("提交了用于超时测试的认领", Boolean(pendingClaimId));

    const { PrismaClient } = await import("@prisma/client");
    const prisma = new PrismaClient();
    // 把时限改到过去，模拟作者 48 小时未处理
    await prisma.claim.update({
      where: { id: pendingClaimId },
      data: { escalateAt: new Date(Date.now() - 60_000) },
    });
    const beforeLoad = await prisma.claim.findUnique({ where: { id: pendingClaimId } });
    check("超时前尚未标记转交", beforeLoad?.escalatedAt === null);

    await fetch(BASE + "/me/claims", { headers: { cookie: userA.cookie } });

    const afterLoad = await prisma.claim.findUnique({ where: { id: pendingClaimId } });
    await prisma.$disconnect();
    check("页面加载后自动标记为已转交管理员", afterLoad?.escalatedAt !== null);

    const escalatedPage = await (
      await fetch(`${BASE}/me/claims/${pendingClaimId}`, { headers: { cookie: userA.cookie } })
    ).text();
    check("页面展示「已转交管理员」", escalatedPage.includes("已转交管理员"));
  }

  console.log("21. 站内通知（CLFP-USR-0013）");
  let notifyUserCookie = null;
  let notifyUserId = null;
  {
    const notifier = await createVerifiedUser("庚");
    notifyUserCookie = notifier?.cookie ?? null;
    check("创建通知测试账号", Boolean(notifier));

    // 匹配产生的通知（前面的里程碑已经产生过匹配）
    const aNotif = await (
      await fetch(BASE + "/me/notifications", { headers: { cookie: userA.cookie } })
    ).text();
    check("通知中心可访问", aNotif.includes("通知中心"));
    check("包含匹配推荐类通知", aNotif.includes("匹配推荐"));

    // 认领申请通知
    const post = await publishPost(userA.cookie, {
      type: "FOUND",
      title: `通知测试-捡到一副眼镜`,
      location: "教学楼",
      occurredAt: now,
      description: "教学楼 A 座捡到一副黑框眼镜，放在门卫处，用于通知测试",
    });
    const claim = await submitAction(
      `/posts/${post.id}/claim`,
      {
        message: "这是我丢的黑框眼镜，镜腿上有磨损痕迹",
        proof: "镜盒内侧写着我的名字缩写，镜片是防蓝光的",
        contact: `wx-notify-${Date.now()}`,
      },
      { cookie: notifyUserCookie, marker: 'name="proof"' },
    );
    const notifyClaimId = (claim.res?.headers.get("location") ?? "").split("/me/claims/")[1];
    check("提交用于通知测试的认领", Boolean(notifyClaimId));

    const aAfterClaim = await (
      await fetch(BASE + "/me/notifications", { headers: { cookie: userA.cookie } })
    ).text();
    check("作者收到「有人申请认领」通知", aAfterClaim.includes("有人申请认领你发布的信息"));
    check("通知显示了类型标签", aAfterClaim.includes("收到认领"));

    const homeWithBadge = await (
      await fetch(BASE + "/", { headers: { cookie: userA.cookie } })
    ).text();
    check("导航栏出现未读角标", homeWithBadge.includes("absolute -right-3.5 -top-2"));

    // 审核结果通知
    await submitAction(
      `/me/claims/${notifyClaimId}`,
      { decision: "REJECT", note: "凭证与物品不符" },
      { cookie: userA.cookie, marker: 'value="REJECT"' },
    );
    const gAfterReject = await (
      await fetch(BASE + "/me/notifications", { headers: { cookie: notifyUserCookie } })
    ).text();
    check("申请人收到审核结果通知", gAfterReject.includes("认领申请未通过"));
    check("通知包含审核备注", gAfterReject.includes("凭证与物品不符"));

    // 再制造一条通知，保证后面「全部标为已读」有东西可标记
    const extraPost = await publishPost(userA.cookie, {
      type: "FOUND",
      title: `通知测试2-捡到一个充电宝`,
      location: "图书馆",
      occurredAt: now,
      description: "图书馆捡到一个白色充电宝，用于第二条通知测试",
    });
    const extraClaim = await submitAction(
      `/posts/${extraPost.id}/claim`,
      {
        message: "这是我丢的充电宝，背面有贴纸",
        proof: "充电宝背面贴着一张动漫贴纸，接口处有轻微划痕",
        contact: `wx-notify2-${Date.now()}`,
      },
      { cookie: notifyUserCookie, marker: 'name="proof"' },
    );
    const extraClaimId = (extraClaim.res?.headers.get("location") ?? "").split("/me/claims/")[1];
    await submitAction(
      `/me/claims/${extraClaimId}`,
      { decision: "REJECT", note: "第二条通知测试" },
      { cookie: userA.cookie, marker: 'value="REJECT"' },
    );

    const { PrismaClient } = await import("@prisma/client");
    const prisma = new PrismaClient();
    const target = await prisma.user.findUnique({
      where: { email: notifier.email },
      select: { id: true },
    });
    notifyUserId = target?.id ?? null;

    const countUnread = () =>
      prisma.notification.count({
        where: { userId: notifyUserId ?? "", readAt: null, deliverAt: { lte: new Date() } },
      });

    const unreadBefore = await countUnread();
    check(`申请人有未读通知（${unreadBefore} 条）`, unreadBefore >= 2);

    // 标记单条已读：用通知 id 精确定位，避免匹配到「全部标为已读」按钮
    const pendingNotification = await prisma.notification.findFirst({
      where: { userId: notifyUserId ?? "", readAt: null, deliverAt: { lte: new Date() } },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });
    check("取到一条未读通知用于单条标记", Boolean(pendingNotification?.id));

    await submitAction(
      "/me/notifications",
      {},
      { cookie: notifyUserCookie, marker: pendingNotification?.id ?? "__none__" },
    );
    const unreadAfterOne = await countUnread();
    check(
      `标记单条已读后未读数减 1（${unreadBefore} → ${unreadAfterOne}）`,
      unreadAfterOne === unreadBefore - 1,
    );

    // 全部标为已读
    const all = await submitAction(
      "/me/notifications",
      {},
      { cookie: notifyUserCookie, marker: "全部标为已读" },
    );
    check(`找到「全部标为已读」按钮并提交成功 (${all.res?.status})`, Boolean(all.res));

    const unreadAfterAll = await countUnread();
    await prisma.$disconnect();
    check(`全部已读后未读数为 0（实际 ${unreadAfterAll}）`, unreadAfterAll === 0);
  }

  console.log("22. 免打扰时段与消息偏好（CLFP-USR-0019）");
  {
    const hour = new Date().getHours();
    const quietEnd = (hour + 1) % 24;

    // 把免打扰时段设为覆盖当前小时
    const saved = await submitAction(
      "/settings",
      { inApp: "on", quietEnabled: "on", quietStart: String(hour), quietEnd: String(quietEnd) },
      { cookie: notifyUserCookie, marker: 'name="quietStart"' },
    );
    check(`保存免打扰偏好成功 (${saved.res?.status})`, saved.res && saved.res.status < 400);

    // 触发一条新通知：应被暂缓
    const postA = await publishPost(userA.cookie, {
      type: "FOUND",
      title: `静音测试-捡到一把雨伞`,
      location: "第一食堂",
      occurredAt: now,
      description: "第一食堂捡到一把折叠雨伞，用于免打扰测试",
    });
    const claimA = await submitAction(
      `/posts/${postA.id}/claim`,
      {
        message: "这是我丢的折叠雨伞，伞柄有划痕",
        proof: "伞骨内侧有一处修补痕迹，伞套是深蓝色的",
        contact: `wx-quiet-${Date.now()}`,
      },
      { cookie: notifyUserCookie, marker: 'name="proof"' },
    );
    const quietClaimId = (claimA.res?.headers.get("location") ?? "").split("/me/claims/")[1];

    await submitAction(
      `/me/claims/${quietClaimId}`,
      { decision: "REJECT", note: "免打扰测试" },
      { cookie: userA.cookie, marker: 'value="REJECT"' },
    );

    const quietPage = await (
      await fetch(BASE + "/me/notifications", { headers: { cookie: notifyUserCookie } })
    ).text();
    check("免打扰时段内通知被暂缓", quietPage.includes("免打扰时段"));
    check("暂缓的通知不出现在列表中", !quietPage.includes("静音测试-捡到一把雨伞"));

    const { PrismaClient } = await import("@prisma/client");
    const prisma = new PrismaClient();
    const queued = await prisma.notification.findFirst({
      where: { userId: notifyUserId ?? "", deliverAt: { gt: new Date() } },
      orderBy: { deliverAt: "asc" },
    });
    await prisma.$disconnect();
    check("暂缓通知的送达时间已推迟", Boolean(queued));
    check("推迟到免打扰结束时刻", queued?.deliverAt.getHours() === quietEnd);

    // 关闭免打扰后，新通知应立即送达
    const disabled = await submitAction(
      "/settings",
      { inApp: "on", quietStart: String(hour), quietEnd: String(quietEnd) },
      { cookie: notifyUserCookie, marker: 'name="quietStart"' },
    );
    check(`关闭免打扰成功 (${disabled.res?.status})`, disabled.res && disabled.res.status < 400);

    const postB = await publishPost(userA.cookie, {
      type: "FOUND",
      title: `即时测试-捡到一个水杯`,
      location: "实验楼",
      occurredAt: now,
      description: "实验楼捡到一个白色保温水杯，用于即时通知测试",
    });
    const claimB = await submitAction(
      `/posts/${postB.id}/claim`,
      {
        message: "这是我丢的白色保温杯，杯底有贴纸",
        proof: "杯底贴着一张卡通贴纸，杯盖内侧有名字贴",
        contact: `wx-instant-${Date.now()}`,
      },
      { cookie: notifyUserCookie, marker: 'name="proof"' },
    );
    const instantClaimId = (claimB.res?.headers.get("location") ?? "").split("/me/claims/")[1];

    await submitAction(
      `/me/claims/${instantClaimId}`,
      { decision: "REJECT", note: "即时通知测试" },
      { cookie: userA.cookie, marker: 'value="REJECT"' },
    );

    const instantPage = await (
      await fetch(BASE + "/me/notifications", { headers: { cookie: notifyUserCookie } })
    ).text();
    check("关闭免打扰后通知立即出现在列表中", instantPage.includes("即时测试-捡到一个水杯"));
  }

  console.log("23. 关闭站内通知后不再写入");
  {
    const off = await submitAction(
      "/settings",
      { quietEnabled: "on", quietStart: "22", quietEnd: "7" },
      { cookie: notifyUserCookie, marker: 'name="quietStart"' },
    );
    check(`关闭站内通知成功 (${off.res?.status})`, off.res && off.res.status < 400);

    const { PrismaClient } = await import("@prisma/client");
    const prisma = new PrismaClient();
    const before = await prisma.notification.count({ where: { userId: notifyUserId ?? "" } });
    await prisma.$disconnect();

    const postC = await publishPost(userA.cookie, {
      type: "FOUND",
      title: `静默测试-捡到一支笔`,
      location: "教学楼",
      occurredAt: now,
      description: "教学楼捡到一支黑色签字笔，用于关闭通知后的测试",
    });
    const claimC = await submitAction(
      `/posts/${postC.id}/claim`,
      {
        message: "这是我丢的签字笔，笔帽有咬痕",
        proof: "笔身上印着某公司的字样，笔帽上有咬痕",
        contact: `wx-silent-${Date.now()}`,
      },
      { cookie: notifyUserCookie, marker: 'name="proof"' },
    );
    const silentClaimId = (claimC.res?.headers.get("location") ?? "").split("/me/claims/")[1];

    await submitAction(
      `/me/claims/${silentClaimId}`,
      { decision: "REJECT", note: "静默测试" },
      { cookie: userA.cookie, marker: 'value="REJECT"' },
    );

    const prisma2 = new PrismaClient();
    const after = await prisma2.notification.count({ where: { userId: notifyUserId ?? "" } });
    await prisma2.$disconnect();
    check(`关闭站内通知后不写入新通知（${before} → ${after}）`, after === before);
  }

  console.log("24. 管理后台：下架与恢复（CLFP-USR-0016）");
  let adminCookie = null;
  let managedPostId = null;
  {
    const login = await submitAction(
      "/login",
      { email: "admin@clfp.local", password: "Admin@12345" },
      { marker: 'name="password"' },
    );
    adminCookie = login.cookie;
    check("管理员登录成功", adminCookie.includes("clfp_session"));

    // 普通用户不能进入后台
    for (const path of ["/admin", "/admin/posts", "/admin/logs", "/admin/config"]) {
      const res = await fetch(BASE + path, {
        headers: { cookie: userA.cookie },
        redirect: "manual",
      });
      check(`普通用户访问 ${path} 被跳转 (${res.status})`, [302, 303, 307].includes(res.status));
    }

    for (const path of ["/admin", "/admin/posts", "/admin/logs", "/admin/config"]) {
      const res = await fetch(BASE + path, { headers: { cookie: adminCookie } });
      check(`管理员访问 ${path} → ${res.status}`, res.status === 200);
    }

    const post = await publishPost(userA.cookie, {
      type: "LOST",
      title: `下架测试-丢失一部手机`,
      location: "教学楼",
      occurredAt: now,
      description: "教学楼丢失一部手机，用于测试管理员下架功能",
    });
    managedPostId = post.id;

    // 注意：搜索页会把关键词回显在搜索框里，所以不能直接用标题判断命中与否，
    // 而要看是否出现「无结果」提示。
    const NO_RESULT = "没有找到包含这些关键词的信息";
    const visibleBefore = await (
      await fetch(`${BASE}/search?q=${encodeURIComponent("下架测试-丢失一部手机")}`)
    ).text();
    check("下架前可以在搜索中看到", !visibleBefore.includes(NO_RESULT));

    const takeDown = await submitAction(
      "/admin/posts",
      { postId: managedPostId, reason: "疑似不实信息" },
      { cookie: adminCookie, marker: [managedPostId ?? "", 'name="reason"'] },
    );
    check(`下架提交成功 (${takeDown.res?.status})`, takeDown.res && takeDown.res.status < 400);

    const { PrismaClient } = await import("@prisma/client");
    const prisma = new PrismaClient();
    const updated = await prisma.post.findUnique({ where: { id: managedPostId ?? "" } });
    const audit = await prisma.auditLog.findFirst({
      where: { targetId: managedPostId ?? "", action: "POST_TAKE_DOWN" },
      include: { operator: { select: { email: true } } },
    });
    const authorNotif = await prisma.notification.findFirst({
      where: { userId: updated?.authorId ?? "", title: "你发布的信息已被下架" },
    });
    await prisma.$disconnect();

    check("帖子已标记为下架", updated?.takenDownAt !== null);
    check("记录了下架原因", updated?.takeDownReason === "疑似不实信息");
    check("写入了操作日志", Boolean(audit));
    check("日志记录了操作人", audit?.operator?.email === "admin@clfp.local");
    check("作者收到了下架通知", Boolean(authorNotif));

    const visibleAfter = await (
      await fetch(`${BASE}/search?q=${encodeURIComponent("下架测试-丢失一部手机")}`)
    ).text();
    check("下架后不出现在搜索中", visibleAfter.includes(NO_RESULT));

    const outsiderView = await fetch(`${BASE}/posts/${managedPostId}`, { redirect: "manual" });
    check(`下架后其他人访问详情返回 ${outsiderView.status}`, outsiderView.status === 404);

    const authorView = await (
      await fetch(`${BASE}/posts/${managedPostId}`, { headers: { cookie: userA.cookie } })
    ).text();
    check("作者仍能看到自己的信息与下架说明", authorView.includes("不再对外公开展示"));

    const myPosts = await (
      await fetch(BASE + "/me/posts", { headers: { cookie: userA.cookie } })
    ).text();
    check("我的发布中标注了被下架", myPosts.includes("这条信息已被管理员下架"));
  }

  console.log("25. 管理后台：恢复与删除");
  {
    const restore = await submitAction(
      "/admin/posts?state=taken_down",
      { postId: managedPostId },
      { cookie: adminCookie, marker: [managedPostId ?? "", "恢复展示"] },
    );
    check(`恢复提交成功 (${restore.res?.status})`, restore.res && restore.res.status < 400);

    const visible = await (
      await fetch(`${BASE}/search?q=${encodeURIComponent("下架测试-丢失一部手机")}`)
    ).text();
    check("恢复后重新出现在搜索中", !visible.includes("没有找到包含这些关键词的信息"));

    const remove = await submitAction(
      "/admin/posts",
      { postId: managedPostId },
      { cookie: adminCookie, marker: managedPostId ?? "", excludeMarker: 'name="reason"' },
    );
    check(`管理员删除提交成功 (${remove.res?.status})`, remove.res && remove.res.status < 400);

    const { PrismaClient } = await import("@prisma/client");
    const prisma = new PrismaClient();
    const deleted = await prisma.post.findUnique({ where: { id: managedPostId ?? "" } });
    const audit = await prisma.auditLog.findFirst({
      where: { targetId: managedPostId ?? "", action: "POST_DELETE" },
    });
    await prisma.$disconnect();

    check("帖子已软删除", deleted?.deletedAt !== null);
    check("写入了删除日志", Boolean(audit));

    const gone = await fetch(`${BASE}/posts/${managedPostId}`, { redirect: "manual" });
    check(`删除后详情不可访问 (${gone.status})`, gone.status === 404);
  }

  console.log("26. 配置中心（CLFP-USR-0025）");
  {
    const { PrismaClient } = await import("@prisma/client");
    const prisma = new PrismaClient();
    const configBefore = await prisma.appConfig.findUnique({ where: { key: "rag.config" } });
    await prisma.$disconnect();

    const threshold = configBefore?.value?.threshold ?? 0.45;
    const newThreshold = threshold === 0.6 ? 0.55 : 0.6;

    const save = await submitAction(
      "/admin/config",
      {
        threshold: String(newThreshold),
        maxMatches: "4",
        windowDays: "45",
        weightVector: "0.5",
        weightCategory: "0.15",
        weightLocation: "0.15",
        weightTime: "0.1",
        weightKeyword: "0.1",
      },
      { cookie: adminCookie, marker: 'name="threshold"' },
    );
    check(`保存匹配配置成功 (${save.res?.status})`, save.res && save.res.status < 400);

    const prisma2 = new PrismaClient();
    const configAfter = await prisma2.appConfig.findUnique({ where: { key: "rag.config" } });
    await prisma2.$disconnect();
    check(
      `阈值已更新为 ${newThreshold}（实际 ${configAfter?.value?.threshold}）`,
      configAfter?.value?.threshold === newThreshold,
    );
    check("时间窗已更新为 45 天", configAfter?.value?.windowDays === 45);

    const matchesPage = await (
      await fetch(BASE + "/me/matches", { headers: { cookie: userA.cookie } })
    ).text();
    check("匹配页读取的是新阈值", matchesPage.includes(String(newThreshold)));

    // 新增类别后应立刻出现在发布表单里
    const categoryName = `测试类别${Date.now() % 100000}`;
    const createCategory = await submitAction(
      "/admin/config",
      { name: categoryName },
      { cookie: adminCookie, marker: 'name="name"' },
    );
    check(
      `新增类别提交成功 (${createCategory.res?.status})`,
      createCategory.res && createCategory.res.status < 400,
    );

    const publishPage = await (
      await fetch(BASE + "/posts/new", { headers: { cookie: userA.cookie } })
    ).text();
    check("新类别出现在发布表单中", publishPage.includes(categoryName));

    const prisma3 = new PrismaClient();
    const category = await prisma3.category.findUnique({ where: { name: categoryName } });
    const createAudit = await prisma3.auditLog.findFirst({
      where: { action: "CATEGORY_CREATE", targetId: category?.id ?? "" },
    });
    await prisma3.$disconnect();
    check("类别写入数据库", Boolean(category?.id));
    check("新增类别写入了操作日志", Boolean(createAudit));

    // 停用类别
    await submitAction(
      "/admin/config",
      {},
      { cookie: adminCookie, marker: category?.id ?? "__none__" },
    );
    const prisma4 = new PrismaClient();
    const disabled = await prisma4.category.findUnique({ where: { id: category?.id ?? "" } });
    await prisma4.$disconnect();
    check("类别已停用", disabled?.enabled === false);

    const publishAfter = await (
      await fetch(BASE + "/posts/new", { headers: { cookie: userA.cookie } })
    ).text();
    check("停用后不再出现在发布表单中", !publishAfter.includes(categoryName));
  }

  console.log("27. 操作日志页面");
  {
    const logs = await (
      await fetch(BASE + "/admin/logs", { headers: { cookie: adminCookie } })
    ).text();
    check("日志页可访问", logs.includes("操作日志"));
    check("日志包含下架记录", logs.includes("下架信息"));
    check("日志包含恢复记录", logs.includes("恢复信息"));
    check("日志包含类别操作", logs.includes("新增类别"));
    check("日志显示操作人", logs.includes("平台管理员"));
  }

  console.log("28. 举报处理（CLFP-USR-0015）");
  let reportedPostId = null;
  let firstReportId = null;
  {
    const reporter = await createVerifiedUser("辛");
    check("创建举报测试账号", Boolean(reporter));

    const post = await publishPost(userA.cookie, {
      type: "FOUND",
      title: `举报测试-捡到一副耳机`,
      location: "教学楼",
      occurredAt: now,
      description: "教学楼捡到一副白色无线耳机，用于测试举报功能",
    });
    reportedPostId = post.id;

    const reportPage = await (
      await fetch(`${BASE}/posts/${reportedPostId}/report`, { headers: { cookie: reporter.cookie } })
    ).text();
    check("举报页面可访问", reportPage.includes("填写举报信息"));

    const submitted = await submitAction(
      `/posts/${reportedPostId}/report`,
      { reason: "不实信息", detail: "这条信息与另一条完全重复，怀疑是刷存在感" },
      { cookie: reporter.cookie, marker: 'name="detail"' },
    );
    check(`举报提交成功 (${submitted.res?.status})`, submitted.res && submitted.res.status < 400);

    const { PrismaClient } = await import("@prisma/client");
    const prisma = new PrismaClient();
    const report = await prisma.report.findFirst({
      where: { targetId: reportedPostId ?? "", reporterId: (await prisma.user.findUnique({ where: { email: reporter.email }, select: { id: true } }))?.id ?? "" },
    });
    firstReportId = report?.id ?? null;
    await prisma.$disconnect();

    check("举报记录已落库", Boolean(firstReportId));
    check("举报状态为待处理", report?.status === "PENDING", String(report?.status));

    // 重复举报应被拦截
    const duplicate = await submitAction(
      `/posts/${reportedPostId}/report`,
      { reason: "重复信息", detail: "重复举报测试" },
      { cookie: reporter.cookie, marker: 'name="detail"' },
    );
    check("重复举报被拦截（拿不到举报表单）", !duplicate.ok);

    const queue = await (
      await fetch(BASE + "/admin/reports", { headers: { cookie: adminCookie } })
    ).text();
    check("管理员举报队列显示该举报", queue.includes("举报测试-捡到一副耳机"));
    check("队列显示举报类型", queue.includes("不实信息"));

    // 受理并下架
    const handle = await submitAction(
      "/admin/reports",
      { takeDown: "on", note: "已核实为重复信息，下架处理" },
      { cookie: adminCookie, marker: [firstReportId ?? "", 'value="RESOLVE"'] },
    );
    check(`受理举报提交成功 (${handle.res?.status})`, handle.res && handle.res.status < 400);

    const prisma2 = new PrismaClient();
    const [handled, takenPost, audit] = await Promise.all([
      prisma2.report.findUnique({ where: { id: firstReportId ?? "" } }),
      prisma2.post.findUnique({ where: { id: reportedPostId ?? "" } }),
      prisma2.auditLog.findFirst({ where: { action: "REPORT_RESOLVE", targetId: reportedPostId ?? "" } }),
    ]);
    await prisma2.$disconnect();

    check("举报状态变为已受理", handled?.status === "RESOLVED", String(handled?.status));
    check("记录处理备注", handled?.handleNote === "已核实为重复信息，下架处理");
    check("受理同时下架了被举报信息", takenPost?.takenDownAt !== null);
    check("写入了举报处理日志", Boolean(audit));

    const hidden = await (
      await fetch(`${BASE}/search?q=${encodeURIComponent("举报测试-捡到一副耳机")}`)
    ).text();
    check("被举报信息下架后搜索不到", hidden.includes("没有找到包含这些关键词的信息"));
  }

  console.log("29. 驳回举报");
  {
    const post = await publishPost(userA.cookie, {
      type: "FOUND",
      title: `驳回测试-捡到一把尺子`,
      location: "实验楼",
      occurredAt: now,
      description: "实验楼捡到一把直尺，用于测试驳回举报",
    });

    const reporter = await createVerifiedUser("壬");
    await submitAction(
      `/posts/${post.id}/report`,
      { reason: "其他", detail: "随便举报一下用于测试驳回流程" },
      { cookie: reporter.cookie, marker: 'name="detail"' },
    );

    const { PrismaClient } = await import("@prisma/client");
    const prisma = new PrismaClient();
    const report = await prisma.report.findFirst({ where: { targetId: post.id } });
    await prisma.$disconnect();
    check("拿到待驳回的举报记录", Boolean(report?.id));

    await submitAction(
      "/admin/reports",
      { note: "核实后信息属实，驳回举报" },
      { cookie: adminCookie, marker: [report?.id ?? "", 'value="REJECT"'] },
    );

    const prisma2 = new PrismaClient();
    const rejected = await prisma2.report.findUnique({ where: { id: report?.id ?? "" } });
    const stillPublic = await prisma2.post.findUnique({ where: { id: post.id } });
    await prisma2.$disconnect();

    check("举报状态变为已驳回", rejected?.status === "REJECTED", String(rejected?.status));
    check("被举报信息保持公开", stillPublic?.takenDownAt === null);
  }

  console.log("30. 公告（CLFP-USR-0024）");
  {
    const stamp = `公告测试${Date.now() % 100000}`;

    const created = await submitAction(
      "/admin/announcements",
      { title: `${stamp} 失物招领处开放时间调整`, body: "本周起失物招领处开放时间调整为 9:00-18:00。", pinned: "on" },
      { cookie: adminCookie, marker: 'name="body"' },
    );
    check(`发布公告成功 (${created.res?.status})`, created.res && created.res.status < 400);

    const home = await (await fetch(BASE + "/")).text();
    check("首页展示公告", home.includes(`${stamp} 失物招领处开放时间调整`));
    check("置顶公告有标记", home.includes("置顶公告"));

    const { PrismaClient } = await import("@prisma/client");
    const prisma = new PrismaClient();
    const announcement = await prisma.announcement.findFirst({
      where: { title: { contains: stamp } },
    });
    await prisma.$disconnect();
    check("公告已落库", Boolean(announcement?.id));
    check("公告置顶标记已保存", announcement?.pinned === true);

    // 取消置顶
    await submitAction(
      "/admin/announcements",
      {},
      { cookie: adminCookie, marker: [announcement?.id ?? "__none__", "取消置顶"] },
    );
    const prisma2 = new PrismaClient();
    const unpinned = await prisma2.announcement.findUnique({ where: { id: announcement?.id ?? "" } });
    await prisma2.$disconnect();
    check("取消置顶生效", unpinned?.pinned === false);

    // 删除公告
    await submitAction(
      "/admin/announcements",
      {},
      { cookie: adminCookie, marker: [announcement?.id ?? "__none__", "删除"] },
    );
    const prisma3 = new PrismaClient();
    const deleted = await prisma3.announcement.findUnique({ where: { id: announcement?.id ?? "" } });
    await prisma3.$disconnect();
    check("公告已删除", deleted === null);

    const homeAfter = await (await fetch(BASE + "/")).text();
    check("删除后首页不再展示", !homeAfter.includes(`${stamp} 失物招领处开放时间调整`));
  }

  console.log("31. 统计报表与导出（CLFP-USR-0017）");
  {
    const stats = await (
      await fetch(BASE + "/admin/stats", { headers: { cookie: adminCookie } })
    ).text();
    check("统计页可访问", stats.includes("按院系统计"));
    check("统计页显示找回率", stats.includes("找回率"));
    check("统计页显示按类别统计", stats.includes("按类别统计"));
    check("统计页显示院系筛选", stats.includes("院系筛选"));

    const filtered = await (
      await fetch(`${BASE}/admin/stats?range=7d&department=${encodeURIComponent("计算机科学与技术学院")}`, {
        headers: { cookie: adminCookie },
      })
    ).text();
    check("按院系与时间段筛选可用", filtered.includes("最近 7 天"));

    const csv = await fetch(`${BASE}/admin/stats/export?range=30d`, {
      headers: { cookie: adminCookie },
    });
    const contentType = csv.headers.get("content-type") ?? "";
    const disposition = csv.headers.get("content-disposition") ?? "";
    // Response.text() 会按规范去掉 BOM，所以 BOM 必须检查原始字节
    const csvBytes = Buffer.from(await csv.arrayBuffer());
    const body = csvBytes.toString("utf8");

    check(`CSV 导出返回 200 (${csv.status})`, csv.status === 200);
    check("响应类型为 CSV", contentType.includes("text/csv"), contentType);
    check("带下载文件名", disposition.includes("attachment"), disposition);
    check("CSV 含总体指标", body.includes("总体指标"));
    check("CSV 含按院系统计", body.includes("按院系统计"));
    check("CSV 含按类别统计", body.includes("按类别统计"));
    check(
      "CSV 带 BOM（Excel 可直接打开）",
      csvBytes[0] === 0xef && csvBytes[1] === 0xbb && csvBytes[2] === 0xbf,
      `前三个字节：${csvBytes[0]},${csvBytes[1]},${csvBytes[2]}`,
    );

    const denied = await fetch(`${BASE}/admin/stats/export`, {
      headers: { cookie: userA.cookie },
      redirect: "manual",
    });
    check(`非管理员导出被拦截 (${denied.status})`, [302, 303, 307].includes(denied.status));
  }

  console.log("32. 毕业归档（CLFP-USR-0021）");
  {
    const graduate = await createVerifiedUser("癸");
    const post = await publishPost(graduate.cookie, {
      type: "LOST",
      title: `归档测试-丢失一个书包`,
      location: "图书馆",
      occurredAt: now,
      description: "图书馆丢失一个黑色书包，用于测试毕业归档",
    });
    check("毕业生账号发布了信息", Boolean(post.id));

    // 改成一个明确已到毕业年份的学号：2019 级本科 → 2023 年毕业
    const { PrismaClient } = await import("@prisma/client");
    const prisma = new PrismaClient();
    const user = await prisma.user.findUnique({ where: { email: graduate.email }, select: { id: true } });
    await prisma.user.update({ where: { id: user?.id ?? "" }, data: { studentNo: "2019010101" } });
    await prisma.$disconnect();

    const usersPage = await (
      await fetch(BASE + "/admin/users", { headers: { cookie: adminCookie } })
    ).text();
    check("用户管理页显示毕业推算", usersPage.includes("已到毕业年份"));
    check("用户管理页显示批量归档入口", usersPage.includes("批量归档这些账号"));

    const beforeArchive = await (
      await fetch(`${BASE}/search?q=${encodeURIComponent("归档测试-丢失一个书包")}`)
    ).text();
    check("归档前可以搜索到", !beforeArchive.includes("没有找到包含这些关键词的信息"));

    const archived = await submitAction(
      "/admin/users",
      {},
      { cookie: adminCookie, marker: "批量归档这些账号" },
    );
    check(`批量归档提交成功 (${archived.res?.status})`, archived.res && archived.res.status < 400);

    const prisma2 = new PrismaClient();
    const [archivedUser, archivedPost, audit] = await Promise.all([
      prisma2.user.findUnique({ where: { id: user?.id ?? "" } }),
      prisma2.post.findUnique({ where: { id: post.id ?? "" } }),
      prisma2.auditLog.findFirst({ where: { action: "USER_ARCHIVE_BATCH" } }),
    ]);
    await prisma2.$disconnect();

    check("账号状态变为已归档", archivedUser?.status === "ARCHIVED", String(archivedUser?.status));
    check("未完成的信息被归档", archivedPost?.archivedAt !== null);
    check("写入了批量归档日志", Boolean(audit));

    const afterArchive = await (
      await fetch(`${BASE}/search?q=${encodeURIComponent("归档测试-丢失一个书包")}`)
    ).text();
    check("归档后不再对外公开", afterArchive.includes("没有找到包含这些关键词的信息"));

    // 归档账号无法登录
    const login = await submitAction(
      "/login",
      { email: graduate.email, password: graduate.password },
      { marker: 'name="password"' },
    );
    const loginHtml = await login.res?.text();
    check("归档账号无法登录", Boolean(loginHtml?.includes("已归档")) || !login.cookie.includes("clfp_session"));

    // 取消归档后恢复
    await submitAction(
      "/admin/users",
      {},
      { cookie: adminCookie, marker: [user?.id ?? "__none__", "取消归档"] },
    );

    const prisma3 = new PrismaClient();
    const [restoredUser, restoredPost] = await Promise.all([
      prisma3.user.findUnique({ where: { id: user?.id ?? "" } }),
      prisma3.post.findUnique({ where: { id: post.id ?? "" } }),
    ]);
    await prisma3.$disconnect();

    check("取消归档后账号恢复", restoredUser?.status === "ACTIVE");
    check("取消归档后信息恢复公开", restoredPost?.archivedAt === null);

    const restoredSearch = await (
      await fetch(`${BASE}/search?q=${encodeURIComponent("归档测试-丢失一个书包")}`)
    ).text();
    check(
      "恢复后重新可以搜索到",
      !restoredSearch.includes("没有找到包含这些关键词的信息"),
    );
  }

  // 清理本次产生的测试账号与其图片文件
  await cleanup();

  console.log(`\n结果：通过 ${passed} 项，失败 ${failed} 项`);
  if (failed > 0) process.exitCode = 1;
}

/** 删除测试账号（级联删除帖子）并清空测试上传的图片 */
async function cleanup() {
  if (createdUserEmails.length === 0) return;
  try {
    const { PrismaClient } = await import("@prisma/client");
    const prisma = new PrismaClient();
    const users = await prisma.user.findMany({
      where: { email: { in: createdUserEmails } },
      include: { posts: { include: { images: true } } },
    });
    const files = users.flatMap((user) => user.posts.flatMap((post) => post.images.map((i) => i.path)));
    await prisma.user.deleteMany({ where: { email: { in: createdUserEmails } } });

    // 测试会新增类别、改匹配配置、发公告，这里一并还原，避免污染演示数据
    const categories = await prisma.category.deleteMany({
      where: { name: { startsWith: "测试类别" } },
    });
    const configs = await prisma.appConfig.deleteMany({
      where: { key: { in: ["rag.config", "rag.category_boost"] } },
    });
    const announcements = await prisma.announcement.deleteMany({
      where: { title: { contains: "公告测试" } },
    });

    await prisma.$disconnect();
    for (const rel of files) {
      await rm(path.join(STORAGE_ROOT, rel), { force: true }).catch(() => {});
    }
    console.log(
      `\n（已清理 ${users.length} 个测试账号、${files.length} 张图片、` +
        `${categories.count} 个测试类别、${configs.count} 条测试配置、${announcements.count} 条测试公告）`,
    );
  } catch (error) {
    console.log(`\n（测试数据清理失败：${error.message}）`);
  }
}

main().catch((error) => {
  console.error("端到端验证异常：", error);
  process.exitCode = 1;
});
