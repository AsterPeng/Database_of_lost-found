/**
 * 读取帖子配图。
 * 已软删除的帖子图片返回 404，避免删除后仍能通过链接看到。
 */
import { readFile } from "node:fs/promises";
import { prisma } from "@/lib/db";
import { resolveImagePath } from "@/lib/storage";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const image = await prisma.postImage.findUnique({
    where: { id },
    include: { post: { select: { deletedAt: true } } },
  });

  if (!image || image.post.deletedAt) {
    return new Response("Not Found", { status: 404 });
  }

  const absolute = resolveImagePath(image.path);
  if (!absolute) return new Response("Not Found", { status: 404 });

  try {
    const data = await readFile(absolute);
    return new Response(new Uint8Array(data), {
      headers: {
        "content-type": image.mimeType,
        "content-length": String(data.byteLength),
        "cache-control": "public, max-age=31536000, immutable",
      },
    });
  } catch {
    return new Response("Not Found", { status: 404 });
  }
}
