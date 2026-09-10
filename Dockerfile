# Kami 纸匣 — Next.js standalone
# docker compose up --build

FROM node:22-bookworm-slim AS build
WORKDIR /app

# 锁文件只有 pnpm-lock.yaml（TD-06 统一包管理）；corepack 按 packageManager 字段选版本
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable
COPY package.json pnpm-lock.yaml .npmrc ./
RUN pnpm install --frozen-lockfile

COPY . .
ENV NODE_ENV=production
# TD-17：默认与应用形态一致（账号开启，同步可用）；要无账号的纯浏览形态，
# 构建时 --build-arg VITE_AUTH_ENABLED=false（数据面届时走局域网配对令牌）
ARG VITE_AUTH_ENABLED=true
ENV VITE_AUTH_ENABLED=$VITE_AUTH_ENABLED
ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm run build

FROM node:22-bookworm-slim AS runner
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
