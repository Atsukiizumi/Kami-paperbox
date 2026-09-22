import type { NextConfig } from "next";
import { execSync } from "node:child_process";

// 版本注入（D1）：优先 CI/镜像构建的 KAMI_VERSION env（docker-release 从 tag
// 注入），本地回退 git describe，都没有（干净 source 包）就是 "dev"。
function resolveKamiVersion(): string {
  if (process.env.KAMI_VERSION) return process.env.KAMI_VERSION;
  try {
    return execSync("git describe --tags --always", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
  } catch {
    return "dev";
  }
}

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Next 16 的 dev 源校验：服务绑 0.0.0.0、浏览器用 127.0.0.1/localhost 访问，
  // 不加白名单会被判跨源，HMR WebSocket 拒连、客户端水合整体挂掉（页面只剩
  // SSR 骨架卡、零数据请求）。局域网 IP 供手机实测热更新（DHCP 变了要跟着补）。
  allowedDevOrigins: ["127.0.0.1", "localhost", "[::1]", "192.168.32.6"],
  output: "standalone",
  serverExternalPackages: ["@electric-sql/pglite", "puppeteer-core", "pg"],
  images: { unoptimized: true },
  env: {
    VITE_AUTH_ENABLED: process.env.VITE_AUTH_ENABLED ?? "",
    KAMI_VERSION: resolveKamiVersion(),
  },
};

export default nextConfig;
