# 纸匣打包导出（E）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** 纸匣当前筛选结果一键导出服务端流式 zip（按画师分文件夹，缺图跳过并记录）。

**Architecture:** 服务端 `POST /api/vault/export`（个人面）用 fflate Zip 流式打包 `.data/vault` 文件；客户端纸匣页按钮收集筛选 keys 触发下载。

**Tech Stack:** fflate（新依赖，纯 JS）；现有 vault-store/readPage。

**Spec:** `docs/superpowers/specs/2026-09-13-vault-export-design.md`

## Global Constraints

- keys 上限 400；个人面不开 guest；不整包进内存（流式）。
- 文件名一律 safeSeg 清洗；zip 内 `_skipped.json` 记录跳过原因。
- commit `git -c commit.gpgsign=false commit --no-gpg-sign`；验证显式退出码。

---

### Task 1: 导出条目纯函数 + 服务端 zip 流

**Files:**
- Create: `src/lib/vault-export.server.ts`（`buildExportEntries(store, keys)` → `{entries: {name, key, page}[], skipped: {key, reason}[]}`；safeSeg 式命名）
- Test: `src/lib/vault-export.server.test.ts`（临时 store 3 条含 1 缺文件）
- Modify: 安装 fflate；Create `src/routes/api/vault-export.ts` + `app/api/vault/export/route.ts`（fflate Zip → ReadableStream → Response，`content-disposition` 带文件名；包尾写 `_skipped.json`）

- [x] 失败测试 → 实现 → 通过（显式退出码）→ 手动 curl 验证 zip 可解压 → commit `feat: 纸匣导出服务端流式 zip`

### Task 2: 纸匣页「导出 ZIP」按钮

**Files:**
- Modify: `src/routes/vault.tsx`（头部按钮：筛选条目 keys、>400 截断提示、bytes 合计 >500MB 建议分批、下载中状态；仅统计 hasFile 条目计数并在按钮 title 注明缺图跳过）

- [x] 手动 QA：导出可下载、按作者分文件夹、_skipped.json 正确
- [x] commit `feat: 纸匣导出 ZIP 按钮`

### Task 3: 收尾

- [x] `pnpm typecheck && pnpm test && pnpm build` 全绿 + eslint 无 error
- [x] docs：CHANGELOG、docs/05、spec 状态、plan 勾选；**路线图 docs/16 补记 C 档不做（用户拍板：AI 补译应走服务端，暂缓）**
- [x] `feat/vault-export` 开 PR，CI 绿后合并
