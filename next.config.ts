import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      // 发布帖子时最多 6 张照片，前端已压缩，这里留出足够余量
      bodySizeLimit: "12mb",
    },
  },
};

export default nextConfig;
