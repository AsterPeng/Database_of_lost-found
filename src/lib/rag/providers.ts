/**
 * 模型供应商实现。
 *
 * - mock：本地特征哈希，无需任何 API Key，默认使用（降级模式）
 * - openai 兼容：适用于 OpenAI、火山方舟（Ark）等提供 /embeddings 与 /chat/completions 的服务
 * - ollama：本地部署的模型
 *
 * 任何远程调用失败都会回退到 mock，保证发布、匹配等主流程不受模型服务影响。
 */
import { featureHashEmbedding } from "./lexical";
import type { ChatMessage, ChatProvider, EmbeddingProvider, EmbedResult } from "./types";

export const MOCK_EMBEDDING_MODEL = "mock-feature-hash-v1";
export const MOCK_DIM = 256;

const DEFAULT_TIMEOUT_MS = 8000;

function timeoutSignal(ms: number): { signal: AbortSignal; cancel: () => void } {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return { signal: controller.signal, cancel: () => clearTimeout(timer) };
}

/** 本地降级用的向量实现，始终可用 */
export function createMockEmbeddingProvider(dim = MOCK_DIM): EmbeddingProvider {
  return {
    name: MOCK_EMBEDDING_MODEL,
    dim,
    async embed(texts) {
      return texts.map((text) => featureHashEmbedding(text, dim));
    },
  };
}

/** OpenAI 兼容的向量服务（OpenAI / 火山方舟 / DeepSeek 等） */
export function createOpenAiCompatibleEmbeddingProvider(config: {
  baseUrl: string;
  apiKey: string;
  model: string;
  dim: number;
}): EmbeddingProvider {
  const endpoint = `${config.baseUrl.replace(/\/$/, "")}/embeddings`;
  return {
    name: config.model,
    dim: config.dim,
    async embed(texts) {
      const { signal, cancel } = timeoutSignal(DEFAULT_TIMEOUT_MS);
      try {
        const response = await fetch(endpoint, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${config.apiKey}`,
          },
          body: JSON.stringify({ model: config.model, input: texts }),
          signal,
        });
        if (!response.ok) {
          throw new Error(`向量服务返回 ${response.status}`);
        }
        const payload = (await response.json()) as { data?: { embedding: number[] }[] };
        const vectors = payload.data?.map((item) => item.embedding) ?? [];
        if (vectors.length !== texts.length) throw new Error("向量服务返回数量不一致");
        return vectors;
      } finally {
        cancel();
      }
    },
  };
}

/** OpenAI 兼容的对话服务 */
export function createOpenAiCompatibleChatProvider(config: {
  baseUrl: string;
  apiKey: string;
  model: string;
}): ChatProvider {
  const endpoint = `${config.baseUrl.replace(/\/$/, "")}/chat/completions`;
  return {
    name: config.model,
    async complete(messages: ChatMessage[], options) {
      const { signal, cancel } = timeoutSignal(options?.timeoutMs ?? DEFAULT_TIMEOUT_MS);
      try {
        const response = await fetch(endpoint, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${config.apiKey}`,
          },
          body: JSON.stringify({
            model: config.model,
            messages,
            max_tokens: options?.maxTokens ?? 300,
            temperature: 0.2,
          }),
          signal,
        });
        if (!response.ok) throw new Error(`对话服务返回 ${response.status}`);
        const payload = (await response.json()) as {
          choices?: { message?: { content?: string } }[];
        };
        return payload.choices?.[0]?.message?.content?.trim() ?? "";
      } finally {
        cancel();
      }
    },
  };
}

/** 本地 Ollama */
export function createOllamaEmbeddingProvider(config: {
  baseUrl: string;
  model: string;
  dim: number;
}): EmbeddingProvider {
  const endpoint = `${config.baseUrl.replace(/\/$/, "")}/api/embeddings`;
  return {
    name: config.model,
    dim: config.dim,
    async embed(texts) {
      const vectors: number[][] = [];
      for (const text of texts) {
        const { signal, cancel } = timeoutSignal(DEFAULT_TIMEOUT_MS);
        try {
          const response = await fetch(endpoint, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ model: config.model, prompt: text }),
            signal,
          });
          if (!response.ok) throw new Error(`Ollama 返回 ${response.status}`);
          const payload = (await response.json()) as { embedding?: number[] };
          if (!payload.embedding) throw new Error("Ollama 未返回向量");
          vectors.push(payload.embedding);
        } finally {
          cancel();
        }
      }
      return vectors;
    },
  };
}

export function createOllamaChatProvider(config: { baseUrl: string; model: string }): ChatProvider {
  const endpoint = `${config.baseUrl.replace(/\/$/, "")}/api/chat`;
  return {
    name: config.model,
    async complete(messages, options) {
      const { signal, cancel } = timeoutSignal(options?.timeoutMs ?? DEFAULT_TIMEOUT_MS);
      try {
        const response = await fetch(endpoint, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ model: config.model, messages, stream: false }),
          signal,
        });
        if (!response.ok) throw new Error(`Ollama 返回 ${response.status}`);
        const payload = (await response.json()) as { message?: { content?: string } };
        return payload.message?.content?.trim() ?? "";
      } finally {
        cancel();
      }
    },
  };
}

export type ProviderKind = "mock" | "openai" | "ollama";

/** 当前配置的向量实现；未配置 Key 时返回 mock */
export function resolveEmbeddingProvider(kind: ProviderKind): EmbeddingProvider {
  const apiKey = process.env.RAG_EMBED_API_KEY;
  const baseUrl = process.env.RAG_EMBED_BASE_URL;
  const model = process.env.RAG_EMBED_MODEL;
  const dim = Number(process.env.RAG_EMBED_DIM ?? "1024");

  if (kind === "openai" && apiKey && baseUrl && model) {
    return createOpenAiCompatibleEmbeddingProvider({ baseUrl, apiKey, model, dim });
  }
  if (kind === "ollama" && model) {
    return createOllamaEmbeddingProvider({
      baseUrl: baseUrl ?? "http://127.0.0.1:11434",
      model,
      dim,
    });
  }
  return createMockEmbeddingProvider();
}

/** 当前配置的对话实现；未配置时返回 null（调用方应使用规则文案） */
export function resolveChatProvider(kind: ProviderKind): ChatProvider | null {
  const apiKey = process.env.RAG_CHAT_API_KEY;
  const baseUrl = process.env.RAG_CHAT_BASE_URL;
  const model = process.env.RAG_CHAT_MODEL;

  if (kind === "openai" && apiKey && baseUrl && model) {
    return createOpenAiCompatibleChatProvider({ baseUrl, apiKey, model });
  }
  if (kind === "ollama" && model) {
    return createOllamaChatProvider({ baseUrl: baseUrl ?? "http://127.0.0.1:11434", model });
  }
  return null;
}

/**
 * 带降级的向量化：主模型失败时自动退回本地实现，并记录原因。
 * 这样模型服务故障不会中断发布流程（CLFP-USR-0020 的可用性要求）。
 */
export async function embedWithFallback(
  texts: string[],
  kind: ProviderKind,
): Promise<EmbedResult> {
  const primary = resolveEmbeddingProvider(kind);

  if (primary.name !== MOCK_EMBEDDING_MODEL) {
    try {
      const vectors = await primary.embed(texts);
      return { vectors, model: primary.name, dim: primary.dim, usedFallback: false };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const fallback = createMockEmbeddingProvider();
      const vectors = await fallback.embed(texts);
      return {
        vectors,
        model: fallback.name,
        dim: fallback.dim,
        usedFallback: true,
        error: message,
      };
    }
  }

  const vectors = await primary.embed(texts);
  return { vectors, model: primary.name, dim: primary.dim, usedFallback: false };
}
