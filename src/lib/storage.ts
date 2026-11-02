/**
 * 图片文件存储：保存在项目下的 storage/uploads 目录。
 * 路径抽象在本文件内，后续换成对象存储只需改这一处。
 */
import { mkdir, unlink, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { MAX_IMAGE_BYTES } from "./constants";

const ROOT = path.join(process.cwd(), "storage", "uploads");

const EXTENSION_BY_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
};

export const ALLOWED_IMAGE_TYPES = Object.keys(EXTENSION_BY_MIME);

export type SavedImage = { path: string; mimeType: string; size: number };

function isValidRelativePath(rel: string): boolean {
  // 防止路径穿越：只允许 yyyy/mm/<hex>.<ext> 形式
  return /^\d{4}\/\d{2}\/[0-9a-f]{32}\.[a-z]{3,4}$/.test(rel);
}

/** 保存一张图片，返回相对路径（如 2026/10/ab12....jpg） */
export async function saveImage(file: File): Promise<SavedImage> {
  const ext = EXTENSION_BY_MIME[file.type];
  if (!ext) throw new Error("不支持的图片格式");
  if (file.size > MAX_IMAGE_BYTES) throw new Error("单张图片不能超过 5MB");

  const now = new Date();
  const dir = `${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2, "0")}`;
  await mkdir(path.join(ROOT, dir), { recursive: true });

  const name = `${randomBytes(16).toString("hex")}.${ext}`;
  const rel = `${dir}/${name}`;
  const buffer = Buffer.from(await file.arrayBuffer());

  await writeFile(path.join(ROOT, rel), buffer);
  return { path: rel, mimeType: file.type, size: buffer.byteLength };
}

/** 相对路径 -> 绝对路径，非法路径返回 null */
export function resolveImagePath(rel: string): string | null {
  if (!isValidRelativePath(rel)) return null;
  return path.join(ROOT, rel);
}

/** 删除图片文件，失败不抛异常（数据库记录优先） */
export async function removeImageFile(rel: string): Promise<void> {
  const absolute = resolveImagePath(rel);
  if (!absolute) return;
  try {
    await unlink(absolute);
  } catch {
    // 文件可能已不存在，忽略
  }
}
