/**
 * 轻量文本工具：分词、特征哈希向量、余弦相似度、Jaccard 重合度。
 *
 * 这里的特征哈希向量是「降级模式」的实现：把中文按字符二元组（bigram）做哈希映射，
 * 得到 L2 归一化的稀疏向量。它对「表述接近」的文本能给出合理的余弦相似度，
 * 但不等价于语义模型——配置了真实向量模型后会自动切换到后者。
 */

export function normalizeText(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

/** 中文按字符二元组切分，同时保留英文数字单词 */
export function charBigrams(text: string): string[] {
  const normalized = normalizeText(text).replace(/[^\p{Script=Han}\p{L}\p{N}]+/gu, "");
  if (normalized.length === 0) return [];
  if (normalized.length === 1) return [normalized];

  const grams: string[] = [];
  for (let i = 0; i < normalized.length - 1; i += 1) {
    grams.push(normalized.slice(i, i + 2));
  }
  return grams;
}

/** FNV-1a 哈希，用于把二元组映射到固定维度 */
function fnv1a(value: string): number {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/** 特征哈希向量：把二元组计数投到 dim 个桶里，再 L2 归一化 */
export function featureHashEmbedding(text: string, dim: number): number[] {
  const vector = new Array<number>(dim).fill(0);
  for (const gram of charBigrams(text)) {
    vector[fnv1a(gram) % dim] += 1;
  }

  let sumOfSquares = 0;
  for (const value of vector) sumOfSquares += value * value;
  const norm = Math.sqrt(sumOfSquares);
  if (norm === 0) return vector;
  return vector.map((value) => value / norm);
}

/** 余弦相似度；任一方为零向量时返回 0 */
export function cosineSimilarity(a: number[], b: number[]): number {
  const length = Math.min(a.length, b.length);
  let dot = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < length; i += 1) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

/** Jaccard 重合度，用于关键词层面的相似程度 */
export function jaccard(a: string[], b: string[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  const setA = new Set(a);
  const setB = new Set(b);
  let intersection = 0;
  for (const item of setA) {
    if (setB.has(item)) intersection += 1;
  }
  const union = setA.size + setB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

export function clamp(value: number, min = 0, max = 1): number {
  return Math.min(max, Math.max(min, value));
}
