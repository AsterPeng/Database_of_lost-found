"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { Alert, Field, SubmitButton } from "@/components/ui";
import { MAX_IMAGES, POST_TYPE_LABEL, PRESET_LOCATIONS } from "@/lib/constants";
import { emptyFormState, type FormState } from "@/lib/form-state";
import { createPostAction, updatePostAction } from "@/server/post-actions";

type CategoryOption = { id: string; name: string };
type ExistingImage = { id: string };
type PickedImage = { key: string; blob: Blob; previewUrl: string; name: string };

/**
 * 浏览器端图片压缩：长边压到 1600px、JPEG 质量 0.82。
 * 压缩结果通过 DataTransfer 写回文件输入框，因此表单提交走的仍是 React 的
 * form action（无 JS 时也能提交原始文件，只是不做压缩）。
 */
async function compressImage(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const maxSide = 1600;
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("当前浏览器不支持图片压缩");
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close?.();

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/jpeg", 0.82),
  );
  if (!blob) throw new Error("图片压缩失败");
  return blob;
}

const selectClass =
  "w-full rounded-lg border-2 border-[#d7c8ad] bg-[#fffefa] px-3 py-2.5 text-sm text-slate-900 outline-none transition focus:border-sky-500 focus:ring-2 focus:ring-sky-100";

export function PostForm({
  mode,
  categories,
  postId,
  defaultOccurredAt,
  defaults,
  existingImages = [],
}: {
  mode: "create" | "edit";
  categories: CategoryOption[];
  postId?: string;
  defaultOccurredAt: string;
  defaults?: {
    type: "LOST" | "FOUND";
    title: string;
    categoryId: string;
    location: string;
    description: string;
    occurredAt: string;
  };
  existingImages?: ExistingImage[];
}) {
  const action = mode === "create" ? createPostAction : updatePostAction;
  const [state, formAction, pending] = useActionState<FormState, FormData>(action, emptyFormState);

  const [type, setType] = useState<"LOST" | "FOUND">(defaults?.type ?? "LOST");
  const [picked, setPicked] = useState<PickedImage[]>([]);
  const [keptIds, setKeptIds] = useState<string[]>(existingImages.map((image) => image.id));
  const [imageError, setImageError] = useState<string>();
  const [processing, setProcessing] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    return () => {
      for (const image of picked) URL.revokeObjectURL(image.previewUrl);
    };
    // 只在卸载时释放
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const totalImages = keptIds.length + picked.length;
  const typeLabel = POST_TYPE_LABEL[type];
  const imageErrorText = imageError ?? state.fieldErrors?.images;

  /** 把压缩后的文件写回文件输入框，保证表单提交的是压缩结果 */
  function syncFileInput(images: PickedImage[]) {
    const input = fileInputRef.current;
    if (!input) return;
    try {
      const transfer = new DataTransfer();
      for (const image of images) {
        transfer.items.add(new File([image.blob], image.name, { type: "image/jpeg" }));
      }
      input.files = transfer.files;
    } catch {
      // 浏览器不支持 DataTransfer 时保留原始文件，只是不做压缩
    }
  }

  async function handleFiles(event: React.ChangeEvent<HTMLInputElement>) {
    const selected = Array.from(event.target.files ?? []);
    if (selected.length === 0) return;

    setImageError(undefined);
    const room = MAX_IMAGES - keptIds.length - picked.length;
    if (selected.length > room) {
      setImageError(`最多上传 ${MAX_IMAGES} 张照片，多余的已忽略`);
    }

    setProcessing(true);
    try {
      const next: PickedImage[] = [];
      for (const file of selected.slice(0, Math.max(0, room))) {
        if (!file.type.startsWith("image/")) {
          setImageError("只能选择图片文件");
          continue;
        }
        try {
          const blob = await compressImage(file);
          next.push({
            key: crypto.randomUUID(),
            blob,
            previewUrl: URL.createObjectURL(blob),
            name: `${file.name.replace(/\.[^.]+$/, "") || "photo"}.jpg`,
          });
        } catch {
          setImageError("有图片无法处理，请换一张试试");
        }
      }

      const merged = [...picked, ...next];
      setPicked(merged);
      syncFileInput(merged);
    } finally {
      setProcessing(false);
    }
  }

  function removePicked(key: string) {
    const target = picked.find((image) => image.key === key);
    if (target) URL.revokeObjectURL(target.previewUrl);
    const merged = picked.filter((image) => image.key !== key);
    setPicked(merged);
    syncFileInput(merged);
  }

  return (
    <form action={formAction} className="space-y-5">
      {state.error ? <Alert>{state.error}</Alert> : null}

      {postId ? <input type="hidden" name="postId" value={postId} /> : null}
      <input type="hidden" name="type" value={type} />
      {keptIds.map((id) => (
        <input key={id} type="hidden" name="keepImageIds" value={id} />
      ))}

      <div>
        <span className="mb-1 block text-sm font-medium text-slate-700">
          信息类型<span className="ml-0.5 text-red-500">*</span>
        </span>
        <div className="flex gap-2">
          {(["LOST", "FOUND"] as const).map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => setType(option)}
              className={`flex-1 rounded-lg border-2 px-4 py-2.5 text-sm font-bold transition hover:-translate-y-0.5 ${
                type === option
                  ? option === "LOST" ? "border-[#cc785b] bg-[#ffe2cc] text-[#8d4738] shadow-[2px_3px_0_#d7ac8c]" : "border-[#6aa99a] bg-[#dcf0e7] text-[#216a62] shadow-[2px_3px_0_#a4cbbf]"
                  : "border-[#d7c8ad] bg-[#fffefa] text-slate-600 hover:bg-[#fff4e1]"
              }`}
            >
              {option === "LOST" ? "我丢了东西" : "我捡到东西"}
            </button>
          ))}
        </div>
      </div>

      <Field
        label="物品名称"
        name="title"
        required
        defaultValue={defaults?.title}
        placeholder="例如：黑色保温杯"
        error={state.fieldErrors?.title}
      />

      <label className="block">
        <span className="mb-1 block text-sm font-medium text-slate-700">
          物品类别<span className="ml-0.5 text-red-500">*</span>
        </span>
        <select name="categoryId" defaultValue={defaults?.categoryId ?? ""} className={selectClass} required>
          <option value="" disabled>
            请选择类别
          </option>
          {categories.map((category) => (
            <option key={category.id} value={category.id}>
              {category.name}
            </option>
          ))}
        </select>
        {state.fieldErrors?.categoryId ? (
          <span className="mt-1 block text-xs text-red-600">{state.fieldErrors.categoryId}</span>
        ) : null}
      </label>

      <div>
        <Field
          label="地点"
          name="location"
          required
          defaultValue={defaults?.location}
          placeholder="例如：图书馆三楼阅览室"
          error={state.fieldErrors?.location}
        />
        <div className="mt-2 flex flex-wrap gap-1.5">
          {PRESET_LOCATIONS.map((location) => (
            <button
              key={location}
              type="button"
              onClick={() => {
                const input = document.querySelector<HTMLInputElement>('input[name="location"]');
                if (input) input.value = location;
              }}
              className="rounded-full border border-slate-200 px-2.5 py-0.5 text-xs text-slate-600 hover:border-sky-400 hover:text-sky-700"
            >
              {location}
            </button>
          ))}
        </div>
      </div>

      <Field
        label={type === "LOST" ? "丢失时间" : "拾得时间"}
        name="occurredAt"
        type="datetime-local"
        required
        defaultValue={defaults?.occurredAt ?? defaultOccurredAt}
        error={state.fieldErrors?.occurredAt}
      />

      <label className="block">
        <span className="mb-1 block text-sm font-medium text-slate-700">
          {type === "LOST" ? "物品特征描述" : "拾得情况说明"}
          <span className="ml-0.5 text-red-500">*</span>
        </span>
        <textarea
          name="description"
          rows={4}
          required
          defaultValue={defaults?.description}
          placeholder="颜色、品牌、外观特征、有没有贴纸或挂件等，写得越具体越容易被匹配到"
          className="w-full rounded-lg border-2 border-[#d7c8ad] bg-[#fffefa] px-3 py-2.5 text-sm text-slate-900 outline-none transition focus:border-sky-500 focus:ring-2 focus:ring-sky-100"
        />
        {state.fieldErrors?.description ? (
          <span className="mt-1 block text-xs text-red-600">{state.fieldErrors.description}</span>
        ) : null}
      </label>

      <div>
        <span className="mb-1 block text-sm font-medium text-slate-700">
          物品照片<span className="ml-0.5 text-red-500">*</span>
          <span className="ml-2 text-xs font-normal text-slate-500">
            {totalImages}/{MAX_IMAGES} 张，自动压缩后上传
          </span>
        </span>

        <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
          {existingImages
            .filter((image) => keptIds.includes(image.id))
            .map((image) => (
              <div
                key={image.id}
                className="relative aspect-square overflow-hidden rounded-lg border border-slate-200"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={`/api/images/${image.id}`}
                  alt="已上传的照片"
                  className="h-full w-full object-cover"
                />
                <button
                  type="button"
                  onClick={() => setKeptIds((prev) => prev.filter((id) => id !== image.id))}
                  className="absolute right-1 top-1 grid h-6 w-6 place-items-center rounded-full bg-black/60 text-xs text-white hover:bg-black/80"
                  aria-label="移除这张照片"
                >
                  ×
                </button>
              </div>
            ))}

          {picked.map((image) => (
            <div
              key={image.key}
              className="relative aspect-square overflow-hidden rounded-lg border border-slate-200"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={image.previewUrl} alt="待上传的照片" className="h-full w-full object-cover" />
              <button
                type="button"
                onClick={() => removePicked(image.key)}
                className="absolute right-1 top-1 grid h-6 w-6 place-items-center rounded-full bg-black/60 text-xs text-white hover:bg-black/80"
                aria-label="移除这张照片"
              >
                ×
              </button>
            </div>
          ))}

          {totalImages < MAX_IMAGES ? (
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={processing}
              className="grid aspect-square place-items-center rounded-lg border border-dashed border-slate-300 text-xs text-slate-500 transition hover:border-sky-400 hover:text-sky-600 disabled:opacity-60"
            >
              {processing ? "压缩中…" : "+ 添加照片"}
            </button>
          ) : null}
        </div>

        <input
          ref={fileInputRef}
          type="file"
          name="images"
          accept="image/*"
          multiple
          onChange={handleFiles}
          className="hidden"
        />

        {imageErrorText ? (
          <span className="mt-1 block text-xs text-red-600">{imageErrorText}</span>
        ) : (
          <span className="mt-1 block text-xs text-slate-500">
            至少 1 张、最多 {MAX_IMAGES} 张；建议拍清楚物品特征，不要拍到证件号码等敏感信息
          </span>
        )}
      </div>

      <SubmitButton pending={pending || processing}>
        {mode === "create" ? `发布${typeLabel}` : "保存修改"}
      </SubmitButton>
    </form>
  );
}
