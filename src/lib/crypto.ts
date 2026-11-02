/**
 * 密码与敏感字段的加密工具。
 *
 * 设计要点：
 * - 密码用 scrypt（内存困难型 KDF）加盐哈希，只存哈希值，永不存明文；
 * - 手机号等敏感字段用 AES-256-GCM 做字段级加密后入库，页面只展示脱敏值；
 * - 会话令牌随机生成，库里只保存它的 SHA-256 摘要。
 */
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
} from "node:crypto";
import { promisify } from "node:util";
import { env } from "./env";

const scrypt = promisify(scryptCallback) as (
  password: string | Buffer,
  salt: Buffer,
  keylen: number,
) => Promise<Buffer>;

const KEY_LENGTH = 64;
const PASSWORD_PREFIX = "scrypt$1";
const FIELD_PREFIX = "v1";

/** 生成密码哈希，格式：scrypt$1$<salt>$<hash> */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  // NFKC 归一化，避免同一密码因 Unicode 表示不同而校验失败
  const derived = await scrypt(password.normalize("NFKC"), salt, KEY_LENGTH);
  return `${PASSWORD_PREFIX}$${salt.toString("base64url")}$${derived.toString("base64url")}`;
}

/** 校验密码，使用定时安全比较避免时序侧信道 */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 4 || `${parts[0]}$${parts[1]}` !== PASSWORD_PREFIX) return false;

  const salt = Buffer.from(parts[2], "base64url");
  const expected = Buffer.from(parts[3], "base64url");
  if (expected.length === 0) return false;

  const derived = await scrypt(password.normalize("NFKC"), salt, expected.length);
  return derived.length === expected.length && timingSafeEqual(derived, expected);
}

/** SHA-256 十六进制摘要，用于会话令牌的落库形式 */
export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/** 生成 URL 安全的随机令牌 */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

function encryptionKey(): Buffer {
  const key = Buffer.from(env.ENCRYPTION_KEY, "base64");
  if (key.length !== 32) {
    throw new Error("ENCRYPTION_KEY 必须是 32 字节的 base64 字符串");
  }
  return key;
}

/** 敏感字段加密，返回 v1.<base64url(iv|tag|ciphertext)> */
export function encryptField(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${FIELD_PREFIX}.${Buffer.concat([iv, tag, encrypted]).toString("base64url")}`;
}

/** 敏感字段解密；数据被篡改或密钥不匹配时返回 null，不抛异常打断页面 */
export function decryptField(payload: string): string | null {
  if (!payload.startsWith(`${FIELD_PREFIX}.`)) return null;
  try {
    const raw = Buffer.from(payload.slice(FIELD_PREFIX.length + 1), "base64url");
    const iv = raw.subarray(0, 12);
    const tag = raw.subarray(12, 28);
    const data = raw.subarray(28);
    const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}

/** 手机号脱敏：138****5678 */
export function maskPhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.length === 11) return `${digits.slice(0, 3)}****${digits.slice(7)}`;
  if (digits.length > 4) return `${digits.slice(0, 2)}****${digits.slice(-2)}`;
  return "****";
}

/**
 * 联系方式脱敏（CLFP-USR-0014）。
 * 手机号按手机号规则处理，其它形式（微信号、QQ 等）只保留首尾字符。
 */
export function maskContact(contact: string): string {
  const trimmed = contact.trim();
  if (/^1[3-9]\d{9}$/.test(trimmed.replace(/\D/g, ""))) return maskPhone(trimmed);

  if (trimmed.length <= 2) return "**";
  if (trimmed.length <= 6) return `${trimmed.slice(0, 1)}****`;
  return `${trimmed.slice(0, 2)}****${trimmed.slice(-2)}`;
}
