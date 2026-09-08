import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  output: "standalone",
  serverExternalPackages: ["@electric-sql/pglite", "puppeteer-core", "pg"],
  images: { unoptimized: true },
  env: {
    VITE_AUTH_ENABLED: process.env.VITE_AUTH_ENABLED ?? "",
    VITE_STUN_URLS: process.env.VITE_STUN_URLS ?? "",
  },
};

export default nextConfig;
