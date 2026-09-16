# 画师更新追踪（A）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** 自选画师更新监控：追踪按钮 + /watch 更新流 + 一键导入 pixiv 关注 + 红点。

**Architecture:** 数据（追踪列表 + 水位）走设置段同步；检测纯客户端聚合既有 `pixivUser`/`fanboxCreator` ops（吃 /api/source 缓存）；唯一新上游 op 是 `pixivMyFollowing`。

**Tech Stack:** 现有栈（zustand persist、fetchSource、node:test）。无新依赖。

**Spec:** `docs/superpowers/specs/2026-09-13-artist-watch-design.md`

## Global Constraints

- `watchLimit` 夹取 20~500 默认 100；`watchArtists` 超限截断。
- 移动端底部导航保持 6 项（PR #111 教训）：追踪入口桌面进侧栏 NAV，移动/全局用顶栏铃铛。
- 追踪页与设置页注明存储占用文案（用户要求）。
- 个人面凭据照旧走 `cookiesFromSettings()`/creds 流；无新 API 路由（复用 /api/source）。
- commit 用 `git -c commit.gpgsign=false commit --no-gpg-sign`；测试 `node --experimental-strip-types --test`；**验证命令必须显式检查退出码**（grep 吞码教训）。

---

### Task 1: watch 数据类型 + 解析 + 设置段接线

**Files:**
- Create: `src/lib/watch.ts`（类型 + `parseWatchArtists` + `WATCH_SOURCES` 校验 + `diffNewCount` 纯函数）
- Test: `src/lib/watch.test.ts`
- Modify: `src/lib/store.ts`（`watchArtists`/`watchLimit` 状态 + `toggleWatchArtist`/`setWatchSeen`/`setWatchLimit`）、`src/lib/backup.ts`（往返）

**Interfaces（Produces）:**
- `type WatchArtist = { source: "pixiv" | "fanbox"; id: string; name: string; avatar: string; addedAt: number; lastSeenId?: string; lastCheckedAt?: number }`
- `parseWatchArtists(raw: unknown, limit: number): WatchArtist[]`
- `diffNewCount(items: { id: string }[], lastSeenId: string | undefined): number`（无水位 → 0，不虚报）
- Store: `toggleWatchArtist(a: {source,id,name,avatar}), setWatchSeen(source, id, lastSeenId), setWatchLimit(n)`

- [x] 失败测试 → 实现 → 通过 → commit `feat: 画师追踪数据模型与解析`

### Task 2: `pixivMyFollowing` op + 缓存键

**Files:**
- Modify: `src/lib/types.ts`（FetchInput/FetchOk 判别联合）、`src/lib/upstream/pixiv.ts`（实现）、`src/lib/source-cache.server.ts`（键）、`src/lib/upstream.server.ts`/dispatch（接线，对照 pixivFollowing）
- Test: 映射单测（mock json → items/nextPage）

- [x] 失败测试 → 实现 → 通过（全量 pnpm test）→ commit `feat: pixivMyFollowing 关注列表 op`

### Task 3: 客户端 watch-store + 检测编排

**Files:**
- Create: `src/lib/watch-check.ts`（`checkWatchArtists(items, creds, {concurrency:2})`：逐画师 fetchSource pixivUser/fanboxCreator → `{artist, newCount, newestId, latestThumb, error?}`；`totalNew`）
- Test: `src/lib/watch-check.test.ts`（mock fetchSource：水位 diff、失败隔离、并发 2）

- [x] 失败测试 → 实现 → 通过 → commit `feat: 追踪检测编排（并发 2 + 失败隔离）`

### Task 4: UI——/watch 页 + 画师页 toggle + 红点入口

**Files:**
- Create: `src/routes/watch.tsx`、`app/watch/page.tsx`
- Modify: `src/routes/user.$id.tsx`（pixiv 追踪 toggle）、`src/routes/creator.$id.tsx`（fanbox toggle）、`src/components/app-shell.tsx`（桌面 NAV + 追踪项；顶栏铃铛角标，移动端唯一入口）、`src/routes/settings.tsx`（watchLimit 输入 + 存储注记文案）

**要点：**
- [x] /watch：检查更新（Task 3 编排）、行内新作数/失败态/最新缩略图、单个与全部标已读、导入 pixiv 关注（分页拉全、去重合并、超限截断提示）、存储占用注记
- [x] 红点角标 = watch-store 汇总（检查后更新，localStorage 持久化）
- [x] Playwright 冒烟：/watch 渲染 + console 干净（未登录态优雅提示）
- [x] commit `feat: 追踪页/画师页 toggle/红点入口`

### Task 5: 收尾

- [x] `pnpm typecheck && pnpm test && pnpm build` 全绿（显式退出码）
- [x] docs：CHANGELOG Unreleased、docs/05 追加小节、spec 状态改已实现、plan 勾选
- [x] 分支 `feat/artist-watch` 开 PR，CI 绿后合并（用户口径）

---

## Self-Review

- Spec 覆盖：模型/检测/导入/红点/上限调整/存储注记（Task 1/2/3/4 全覆盖）✓
- 类型一致：`WatchArtist` 在 1/3/4 一致；`diffNewCount` 在 1/3 一致 ✓
- 无占位符；UI 任务给行为级要求 + 对照文件。
