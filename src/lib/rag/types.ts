/**
 * 向量与对话模型的统一接口（CLFP-USR-0025：不修改业务代码即可接入新模型）。
 * 业务层只依赖这里的接口，具体实现由 providers.ts 按配置选择。
 */

export type EmbeddingProvider = {
  /** 模型标识，会随向量一起入库，换模型后据此重建 */
  name: string;
  /** 向量维度 */
  dim: number;
  embed(texts: string[]): Promise<number[][]>;
};

export type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type ChatProvider = {
  name: string;
  complete(
    messages: ChatMessage[],
    options?: { timeoutMs?: number; maxTokens?: number },
  ): Promise<string>;
};

export type EmbedResult = {
  vectors: number[][];
  model: string;
  dim: number;
  /** 是否因为主模型不可用而回退到本地降级实现 */
  usedFallback: boolean;
  error?: string;
};
