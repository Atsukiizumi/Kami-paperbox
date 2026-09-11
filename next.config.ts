import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Next 16 的 dev 源校验：服务绑 0.0.0.0、浏览器用 127.0.0.1/localhost 访问，
  // 不加白名单会被判跨源，HMR WebSocket 拒连、客户端水合整体挂掉（页面只剩
  // SSR 骨架卡、零数据请求）。
  allowedDevOrigins: ["127.0.0.1", "localhost", "[::1]"],
  output: "standalone",
  serverExternalPackages: ["@electric-sql/pglite", "puppeteer-core", "pg"],
  images: { unoptimized: true },
  env: {
    VITE_AUTH_ENABLED: process.env.VITE_AUTH_ENABLED ?? "",
    VITE_STUN_URLS: process.env.VITE_STUN_URLS ?? "",
  },
};

export default nextConfig;
