# 批量收藏（D）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** 画师页勾选作品批量入纸匣/下载（单次上限 200）。

**Architecture:** ArtworkGrid/ArtworkCard 加可选 selection 属性渲染勾选 chip；画师页用页面级 useState 管选择态；入队复用 enqueueWorks，入队前按 vaultIndex/队列状态过滤。

**Tech Stack:** 现有栈。无新依赖。

**Spec:** `docs/superpowers/specs/2026-09-13-batch-collect-design.md`

## Global Constraints

- `BATCH_MAX = 200`；队列记录在 localStorage（5MB 限），不放宽。
- 勾选 chip 必须 stopPropagation + preventDefault，不触发卡片导航。
- commit `git -c commit.gpgsign=false commit --no-gpg-sign`；验证命令显式检查退出码。

---

### Task 1: 纯函数 + ArtworkGrid/Card selection 属性

**Files:**
- Create: `src/lib/batch-collect.ts`（`BATCH_MAX`、`filterBatchable(cards, {inVaultKeys, inQueueKeys})` → {batchable, skippedVault, skippedQueue}）
- Test: `src/lib/batch-collect.test.ts`
- Modify: `src/components/artwork-card.tsx`（ArtworkCard 可选 `selection` prop → 左上角 chip；ArtworkGrid 可选 `selection: {selected: Set<string>, onToggle(key)}` 透传）

- [x] 失败测试（filterBatchable：三类计数正确；超 BATCH_MAX 截断提示由调用方处理）→ 实现 → 通过 → commit `feat: 批量收藏过滤纯函数 + 卡片勾选属性`

### Task 2: 画师页接线（pixiv user + fanbox creator）

**Files:**
- Create: `src/components/batch-toolbar.tsx`（浮动条：已选数/全选本页/清除/入纸匣/下载/完成；>BATCH_MAX 禁用并提示）
- Modify: `src/routes/user.$id.tsx`（选择模式 toggle；pickup + items 勾选；「加载至 200」循环 fetchNextPage；入队调用）
- Modify: `src/routes/creator.$id.tsx`（同模式）

- [x] 两页进入选择模式 → 勾选 → 入队（filterBatchable 过滤后 enqueueWorks + toast 计数）
- [x] Playwright 冒烟：选择模式渲染、chip 勾选改变计数、浮动条出现、零页面错误
- [x] commit `feat: 画师页勾选批量收藏（pixiv/fanbox）`

### Task 3: 收尾

- [x] `pnpm typecheck && pnpm test && pnpm build` 全绿（显式退出码）+ eslint 改动文件无 error
- [x] docs：CHANGELOG Unreleased、docs/05 小节、spec 状态、plan 勾选
- [x] `feat/batch-collect` 开 PR，CI 绿后合并（用户口径）
