# syntax=docker/dockerfile:1
# check=skip=SecretsUsedInArgOrEnv
# ↑ parser 指令必须在文件最顶（前面有任何注释都会被当普通注释忽略——#131 的
#   豁免因此失效过一轮）。VITE_AUTH_ENABLED 是会进客户端 bundle 的公开构建
#   旗标（true/false，非密钥），跳过 buildx 的假阳性密钥检查。

# Kami 纸匣 — Next.js standalone（node:24 = Active LTS，CI setup-node 同步）
# docker compose up --build

FROM node:24.21.0-bookworm-slim AS build
WORKDIR /app

# 锁文件只有 pnpm-lock.yaml（TD-06 统一包管理）；corepack 按 packageManager 字段选版本
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
RUN pnpm install --frozen-lockfile

# D1：CI 从 git tag 注入版本；本地 build 回退 dev（next.config 再回退 git describe）。
# F5（第三波审查热修）：放在 install 之后——ARG 进层缓存键，放 install 前会让
# 依赖层随每次版本号变化全量 miss（VITE_AUTH_ENABLED 的 ARG 就是这个正确位置）。
ARG KAMI_VERSION=dev
ENV KAMI_VERSION=${KAMI_VERSION}

COPY . .
ENV NODE_ENV=production
# TD-17：默认与应用形态一致（账号开启，同步可用）；要无账号的纯浏览形态，
# 构建时 --build-arg VITE_AUTH_ENABLED=false（数据面届时走局域网配对令牌）
ARG VITE_AUTH_ENABLED=true
ENV VITE_AUTH_ENABLED=$VITE_AUTH_ENABLED
ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm run build

FROM node:24.21.0-bookworm-slim AS runner
ARG KAMI_VERSION=dev
ENV KAMI_VERSION=${KAMI_VERSION}
WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    curl \
    ca-certificates \
    chromium \
    fonts-liberation \
    fonts-noto-cjk \
  && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production
ENV HOSTNAME=0.0.0.0
ENV PORT=8080
ENV NEXT_TELEMETRY_DISABLED=1
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=1

COPY --from=build --chown=node:node /app/public ./public
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
COPY --from=build --chown=node:node /app/migrations ./migrations
COPY --from=build --chown=node:node /app/kami.config.example.json ./kami.config.example.json
COPY --from=build --chown=node:node /app/kami.config.example.json ./kami.config.json
RUN mkdir -p /app/.data && chown -R node:node /app

USER node
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD curl -fsS http://127.0.0.1:8080/ >/dev/null || exit 1

CMD ["node", "server.js"]
