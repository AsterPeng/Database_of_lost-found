/**
 * M1 冒烟测试：不启动 Web 服务器，直接验证密码、加密、校验规则与数据库读写。
 * 运行：npm run verify:m1
 */
import { PrismaClient } from "@prisma/client";
import { encryptField, decryptField, hashPassword, maskContact, maskPhone, verifyPassword } from "../src/lib/crypto";
import { computeDeliverAt, isInQuietHours } from "../src/lib/notifications";
import { registerSchema, profileSchema } from "../src/lib/validation";

const prisma = new PrismaClient();

let passed = 0;
let failed = 0;

function check(name: string, ok: boolean, detail = "") {
  if (ok) {
    passed += 1;
    console.log(`  ✓ ${name}`);
  } else {
    failed += 1;
    console.log(`  ✗ ${name} ${detail}`);
  }
}

async function main() {
  console.log("1. 密码哈希与校验");
  const hash = await hashPassword("Demo@12345");
  check("哈希格式正确", hash.startsWith("scrypt$1$"), hash);
  check("正确密码通过", await verifyPassword("Demo@12345", hash));
  check("错误密码拒绝", !(await verifyPassword("Demo@1234", hash)));
  check("损坏的哈希被拒绝", !(await verifyPassword("Demo@12345", "broken")));
  const hash2 = await hashPassword("Demo@12345");
  check("同一密码两次哈希不同（含随机盐）", hash !== hash2);

  console.log("2. 敏感字段加密与脱敏");
  const phone = "13912345678";
  const encrypted = encryptField(phone);
  check("密文不含明文", !encrypted.includes(phone));
  check("解密还原一致", decryptField(encrypted) === phone);
  check("密文被篡改时返回 null", decryptField(encrypted.slice(0, -4) + "AAAA") === null);
  check("手机号脱敏正确", maskPhone(phone) === "139****5678", maskPhone(phone));
  check("手机号走手机号脱敏规则", maskContact(phone) === "139****5678", maskContact(phone));
  check("微信号脱敏保留首尾", maskContact("wxid_abc123") === "wx****23", maskContact("wxid_abc123"));
  check("短联系方式也能脱敏", maskContact("ab") === "**", maskContact("ab"));

  console.log("3. 表单校验规则");
  check(
    "合法注册信息通过",
    registerSchema.safeParse({
      email: "Test@Example.com",
      nickname: "测试",
      password: "abcd1234",
      confirmPassword: "abcd1234",
    }).success,
  );
  check(
    "两次密码不一致被拒",
    !registerSchema.safeParse({
      email: "a@b.com",
      nickname: "测试",
      password: "abcd1234",
      confirmPassword: "abcd12345",
    }).success,
  );
  check(
    "弱密码被拒",
    !registerSchema.safeParse({
      email: "a@b.com",
      nickname: "测试",
      password: "123",
      confirmPassword: "123",
    }).success,
  );
  check("非法邮箱被拒", !registerSchema.safeParse({
    email: "not-an-email",
    nickname: "测试",
    password: "abcd1234",
    confirmPassword: "abcd1234",
  }).success);
  check(
    "非法手机号被拒",
    !profileSchema.safeParse({
      realName: "张三",
      studentNo: "2023010101",
      department: "计算机学院",
      phone: "12345",
    }).success,
  );

  console.log("4. 免打扰时段与通知送达时间");
  check("跨天时段：23 点属于 22-7", isInQuietHours(23, 22, 7));
  check("跨天时段：凌晨 3 点属于 22-7", isInQuietHours(3, 22, 7));
  check("跨天时段：中午 12 点不属于 22-7", !isInQuietHours(12, 22, 7));
  check("同日时段：13 点属于 12-14", isInQuietHours(13, 12, 14));
  check("起始与结束相同视为不启用", !isInQuietHours(22, 22, 22));

  {
    const now = new Date();
    check("未设置偏好时立即送达", computeDeliverAt(null, now).getTime() === now.getTime());
    check(
      "关闭免打扰时立即送达",
      computeDeliverAt({ quietEnabled: false, quietStart: 22, quietEnd: 7 }, now).getTime() ===
        now.getTime(),
    );

    // 构造一个覆盖「当前小时」的免打扰时段，验证送达时间被推迟到时段结束
    const hour = now.getHours();
    const deliverAt = computeDeliverAt(
      { quietEnabled: true, quietStart: hour, quietEnd: (hour + 1) % 24 },
      now,
    );
    check("免打扰时段内会推迟送达", deliverAt.getTime() > now.getTime());
    check("推迟到时段结束整点", deliverAt.getMinutes() === 0 && deliverAt.getSeconds() === 0);
  }

  console.log("5. 数据库读写（使用临时账号，结束前删除）");
  const email = `smoke-${Date.now()}@clfp.local`;
  const created = await prisma.user.create({
    data: {
      email,
      nickname: "冒烟测试",
      passwordHash: hash,
      realName: "测试用户",
      studentNo: "SMOKE0001",
      department: "测试院系",
      phoneEncrypted: encryptField(phone),
      phoneMasked: maskPhone(phone),
      profileCompleted: true,
    },
  });
  check("用户写入成功", Boolean(created.id));

  const found = await prisma.user.findUnique({ where: { email } });
  check("按邮箱查询成功", found?.id === created.id);
  check("手机号以密文存储", Boolean(found) && !found!.phoneEncrypted!.includes(phone));
  check("脱敏值可用于展示", found?.phoneMasked === "139****5678");

  const sessionToken = "smoke-token-plain";
  const { sha256 } = await import("../src/lib/crypto");
  const session = await prisma.session.create({
    data: {
      userId: created.id,
      tokenHash: sha256(sessionToken),
      expiresAt: new Date(Date.now() + 60_000),
    },
  });
  check("会话写入成功", Boolean(session.id));
  const sessionFound = await prisma.session.findUnique({ where: { tokenHash: sha256(sessionToken) } });
  check("按令牌摘要可查会话", sessionFound?.userId === created.id);
  check("库中不存在明文令牌", sessionFound?.tokenHash !== sessionToken);

  // 级联删除：删用户应同时删会话
  await prisma.user.delete({ where: { id: created.id } });
  const sessionLeft = await prisma.session.findUnique({ where: { id: session.id } });
  check("删除用户会级联删除会话", sessionLeft === null);
  check("临时账号已清理", (await prisma.user.findUnique({ where: { email } })) === null);

  console.log(`\n结果：通过 ${passed} 项，失败 ${failed} 项`);
  if (failed > 0) process.exitCode = 1;
}

main()
  .catch((error) => {
    console.error("冒烟测试异常：", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
