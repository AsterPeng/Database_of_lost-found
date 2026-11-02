/** 让脚本能读到 .env（tsx 不会自动加载），必须作为第一个 import */
import { existsSync } from "node:fs";

const loader = (process as unknown as { loadEnvFile?: (path?: string) => void }).loadEnvFile;

if (typeof loader === "function" && existsSync(".env")) {
  try {
    loader(".env");
  } catch {
    // .env 不存在或格式异常时忽略，后续由具体脚本报错
  }
}
