# 纸匣智能库（B）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把纸匣从平铺列表升级成可管理的库：标签/月份组合筛选、智能文件夹、感知哈希查重（只标记+手动处理）、统计面板四模块。

**Architecture:** 按数据所在侧分工——哈希/查重/存储聚合在服务端 vault-store SQLite；筛选/智能文件夹/分布统计在客户端（meta 已全量同步）。查重结果不落库，由哈希现场重算。

**Tech Stack:** Next 16 App Router、node:sqlite（DatabaseSync）、zustand 设置段、jpeg-js + pngjs（纯 JS 解码）、node:test。

**Spec:** `docs/superpowers/specs/2026-09-12-vault-smart-library-design.md`

## Global Constraints

- 个人面路由一律 `withDataPlane` 包裹且**不开 guest**（对齐 `app/api/vault/route.ts` 现状）。
- vault 的表建在 `vault-store.server.ts` 的 `SCHEMA`（`CREATE TABLE IF NOT EXISTS`），**不是** `migrations/`（那是账号 PGlite 库——spec 中「迁移 0004」按此修正）。
- 不引 sharp/canvas/图表库；解码只支持 jpeg/png，webp 记为无哈希。
- 汉明距离默认阈值 10；dHash 为 64-bit 十六进制字符串（16 字符）。
- 所有测试走 `node --experimental-strip-types --test`（现有 `pnpm test` 模式）；commit 用 `git -c commit.gpgsign=false commit --no-gpg-sign`。
- db-snapshot 动态枚举 public 表（vault.sqlite 不在快照范围，它本就是磁盘目录的附属索引）——**零快照改动**。

---

### Task 1: dHash 核心（解码 + 灰度缩放 + 64-bit 哈希 + 汉明距离）

**Files:**
- Create: `src/lib/dhash.ts`
- Test: `src/lib/dhash.test.ts`

**Interfaces（Produces）:**
- `dhashFromRgba(width: number, height: number, rgba: Uint8Array): string` — 64-bit hex
- `hammingHex(a: string, b: string): number`
- `dhashFromBytes(bytes: Uint8Array, mime: string): Promise<string | null>` — null = 不支持的格式/解码失败

- [ ] **Step 1: 安装依赖**

```bash
pnpm add jpeg-js pngjs
```

- [ ] **Step 2: 写失败测试**（`src/lib/dhash.test.ts`）

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { dhashFromRgba, hammingHex, dhashFromBytes } from "./dhash.ts";
import { PNG } from "pngjs";

// 生成纯色渐变图（同内容、不同尺寸应得到相近哈希）
function makeRgba(w: number, h: number, paint: (x: number, y: number) => [number, number, number]): Uint8Array {
  const out = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const [r, g, b] = paint(x, y);
    out.set([r, g, b, 255], (y * w + x) * 4);
  }
  return out;
}

test("同内容不同尺寸 → 汉明距离小", () => {
  const paint = (x: number, y: number) => [x * 8 % 256, y * 8 % 256, 128] as [number, number, number];
  const a = dhashFromRgba(300, 300, makeRgba(300, 300, paint));
  const b = dhashFromRgba(160, 200, makeRgba(160, 200, paint));
  assert.ok(hammingHex(a, b) <= 6, `distance=${hammingHex(a, b)}`);
});

test("明显不同内容 → 距离大", () => {
  const left = dhashFromRgba(64, 64, makeRgba(64, 64, () => [255, 0, 0]));
  const right = dhashFromRgba(64, 64, makeRgba(64, 64, (x) => (x < 32 ? [255, 255, 255] : [0, 0, 0])));
  assert.ok(hammingHex(left, right) >= 20);
});

test("png 解码路径 + webp 返回 null", async () => {
  const png = new PNG({ width: 40, height: 40 });
  for (let y = 0; y < 40; y++) for (let x = 0; x < 40; x++) {
    const i = (40 * y + x) << 2;
    png.data[i] = (x * 6) % 256; png.data[i + 3] = 255;
  }
  const buf = PNG.sync.write(png);
  const h = await dhashFromBytes(new Uint8Array(buf), "image/png");
  assert.match(h ?? "", /^[0-9a-f]{16}$/);
  assert.equal(await dhashFromBytes(new Uint8Array([1]), "image/webp"), null);
});
```

- [ ] **Step 3: 跑测试确认失败**

Run: `node --experimental-strip-types --test src/lib/dhash.test.ts` → FAIL（模块不存在）

- [ ] **Step 4: 实现**（`src/lib/dhash.ts`）

```ts
/**
 * dHash 感知哈希（纸匣查重用）。
 *
 * 作用：64-bit 差值哈希 + 汉明距离——同图不同尺寸/来源距离小，异图距离大。
 * 用法：dhashFromBytes(收藏第一页文件, mime)；hammingHex 比对。
 * 为什么 dHash 而不是 md5：字节级哈希对重编码/缩放全变，查不了「同图不同源」。
 */
import jpeg from "jpeg-js";
import { PNG } from "pngjs";

/** 9×8 灰度 → 横向差分 → 64 bit → 16 位 hex。RGBA 输入任意尺寸。 */
export function dhashFromRgba(width: number, height: number, rgba: Uint8Array): string {
  const gw = 9, gh = 8;
  const gray = new Float64Array(gw * gh);
  // 盒式降采样：每个目标像素取所在源块的平均亮度
  for (let gy = 0; gy < gh; gy++) {
    const y0 = Math.floor((gy * height) / gh), y1 = Math.max(y0 + 1, Math.floor(((gy + 1) * height) / gh));
    for (let gx = 0; gx < gw; gx++) {
      const x0 = Math.floor((gx * width) / gw), x1 = Math.max(x0 + 1, Math.floor(((gx + 1) * width) / gw));
      let sum = 0, n = 0;
      for (let y = y0; y < y1 && y < height; y++) for (let x = x0; x < x1 && x < width; x++) {
        const i = (y * width + x) * 4;
        sum += 0.299 * rgba[i] + 0.587 * rgba[i + 1] + 0.114 * rgba[i + 2];
        n += 1;
      }
      gray[gy * gw + gx] = n ? sum / n : 0;
    }
  }
  let hex = "";
  for (let gy = 0; gy < gh; gy++) for (let gx = 0; gx < gw - 1; gx++) {
    hex += gray[gy * gw + gx] < gray[gy * gw + gx + 1] ? "1" : "0";
  }
  // 64 bit → 16 hex
  let out = "";
  for (let i = 0; i < 64; i += 4) out += parseInt(hex.slice(i, i + 4), 2).toString(16);
  return out;
}

export function hammingHex(a: string, b: string): number {
  if (a.length !== b.length) return 64;
  let d = 0;
  for (let i = 0; i < a.length; i++) {
    d += popcount(parseInt(a[i], 16) ^ parseInt(b[i], 16));
  }
  return d;
}

function popcount(v: number): number {
  let c = 0;
  while (v) { c += v & 1; v >>= 1; }
  return c;
}

/** jpeg/png 解码入口；其它 mime 返回 null（webp 等暂不支持，覆盖率如实显示）。 */
export async function dhashFromBytes(bytes: Uint8Array, mime: string): Promise<string | null> {
  try {
    if (mime.includes("png")) {
      const png = PNG.sync.read(Buffer.from(bytes));
      return dhashFromRgba(png.width, png.height, new Uint8Array(png.data));
    }
    if (mime.includes("jpeg") || mime.includes("jpg")) {
      const img = jpeg.decode(Buffer.from(bytes), { useTArray: true });
      return dhashFromRgba(img.width, img.height, img.data as unknown as Uint8Array);
    }
    return null;
  } catch {
    return null;
  }
}
```

- [ ] **Step 5: 跑测试确认通过** → PASS
- [ ] **Step 6: Commit** `feat: dHash 感知哈希核心（查重地基）`

---

### Task 2: vault-store 哈希/忽略表 + 入库即算

**Files:**
- Modify: `src/lib/vault-store.server.ts`（SCHEMA、`VaultStore` 接口、`put`、`remove`、新增方法）
- Test: `src/lib/vault-store.server.test.ts`（追加）

**Interfaces（Produces）:**
- `VaultStore.putHash(key: string, dhash: string, w: number, h: number): void`
- `VaultStore.hashes(): { key: string; dhash: string }[]`
- `VaultStore.dismissPair(a: string, b: string): void`
- `VaultStore.dismissedPairs(): string[]`
- `VaultStore.storageBy(group: "source" | "author"): { name: string; bytes: number; count: number }[]`（works.bytes 已有，SQL 聚合）

- [ ] **Step 1: 写失败测试**（追加到 vault-store.server.test.ts）

```ts
test("put 后可查哈希；remove 清理；dismiss 往返；storageBy 聚合", () => {
  const root = mkdtempSync(join(tmpdir(), "kami-vault-dh-"));
  const store = openVaultStore(root);
  try {
    // put 一条带 png 首页的记录 → 哈希自动算出
    const png = PNG.sync.write(Object.assign(new PNG({ width: 24, height: 24 }), { data: grayData(24, 24) }));
    store.put(metaOf("pixiv", "9001"), [{ bytes: new Uint8Array(png), ext: "png", mime: "image/png" }]);
    const hs = store.hashes();
    assert.equal(hs.length, 1);
    assert.match(hs[0].dhash, /^[0-9a-f]{16}$/);
    store.dismissPair("pixiv:9001", "danbooru:1");
    assert.equal(store.dismissedPairs().length, 1);
    assert.ok(store.storageBy("source").some((g) => g.name === "pixiv" && g.count === 1));
    store.remove("pixiv:9001");
    assert.equal(store.hashes().length, 0);
  } finally {
    store.close();
    rmSync(root, { recursive: true, force: true });
  }
});
```

（`metaOf` / `grayData` 为测试内小工具，按现有测试的 meta 构造习惯写。）

- [ ] **Step 2: 跑测试确认失败** → FAIL（方法不存在）
- [ ] **Step 3: 实现**
  - `SCHEMA` 追加：

```sql
CREATE TABLE IF NOT EXISTS vault_hash (
  key TEXT PRIMARY KEY,
  dhash TEXT NOT NULL,
  w INTEGER NOT NULL,
  h INTEGER NOT NULL,
  computed_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS vault_dup_dismissed (
  pair TEXT PRIMARY KEY,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

  - 接口新增四方法（prepared statements 模式对齐现有代码）；`pair = [a, b].sort().join("|")`。
  - `put()` 内：第一页写入成功后 `void dhashFromBytes(...)` 同步调用（同步 IO 流程内，解码毫秒级）写 `putHash`；解码失败不写。
  - `remove()` 内：`DELETE FROM vault_hash WHERE key = ?`。
  - `storageBy`：`SELECT source AS name, SUM(bytes) AS bytes, COUNT(*) AS count FROM works GROUP BY source ORDER BY bytes DESC`（author 同理，author 空串归 `"(未命名)"`）。
- [ ] **Step 4: 跑测试确认通过** → PASS
- [ ] **Step 5: Commit** `feat: vault-store 哈希/忽略表与入库即算`

---

### Task 3: 查重聚类纯函数

**Files:**
- Create: `src/lib/vault-dedup.ts`
- Test: `src/lib/vault-dedup.test.ts`

**Interfaces（Produces）:**
- `pairKeyOf(a: string, b: string): string`
- `clusterDupes(items: { key: string; dhash: string }[], threshold = 10, dismissed: string[] = []): { keys: string[]; maxDistance: number }[]`

- [ ] **Step 1: 写失败测试**

```ts
test("A~B、B~C、A≁C：并查集聚成一组；dismissed 对排除成员", () => {
  const A = "f".repeat(16), B = flip(A, 8), C = flip(B, 8); // A-B=8, B-C=8, A-C=16
  const groups = clusterDupes(
    [{ key: "a", dhash: A }, { key: "b", dhash: B }, { key: "c", dhash: C }, { key: "d", dhash: "0".repeat(16) }],
    10,
    [pairKeyOf("a", "b")],
  );
  // a-b 被忽略 → 只剩 b-c 一组
  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0].keys, ["b", "c"]);
});
```

（`flip(hex, n)` = 翻转前 n bit 的测试工具。）

- [ ] **Step 2: 确认失败 → Step 3: 实现**（union-find；O(n²) 两两汉明；组件 ≥2 才成组；组内 maxDistance 汇报；dismissed 的 pair 两端不连边，孤立端不出现）
- [ ] **Step 4: 通过 → Step 5: Commit** `feat: 查重聚类（并查集 + 忽略对排除）`

---

### Task 4: dedup / storage API

**Files:**
- Create: `app/api/vault/dedup/route.ts`、`src/routes/api/vault-dedup.ts`
- Create: `app/api/vault/stats/storage/route.ts`（薄封装 `withDataPlane`，同 `app/api/vault/route.ts` 模式）

**Interfaces（Produces，客户端 Task 8/10 消费）:**
- `POST /api/vault/dedup` `{action:"scan", threshold?}` → `{ok:true, hashed:number, total:number, groups:{keys:string[]; maxDistance:number}[]}`
- `POST /api/vault/dedup` `{action:"dismiss", a, b}` → `{ok:true}`
- `GET /api/vault/dedup` → `{groups, hashed, total}`（不补算，纯重算）
- `GET /api/vault/stats/storage` → `{bySource:{name,bytes,count}[], byAuthor:{name,bytes,count}[]}`

- [ ] **Step 1: 实现 `src/routes/api/vault-dedup.ts`**：scan = 遍历 `list()`，对 `hashes()` 里没有的 key `readPage(key, 0)` 取首页字节 → `dhashFromBytes` → `putHash`（每 50 条 `setImmediate` yield）；然后 `clusterDupes(hashes(), threshold, dismissedPairs())`。GET 同 scan 但跳过补算。dismiss = 校验 a/b 存在后 `dismissPair`。
- [ ] **Step 2: app 路由薄封装**（对照 `app/api/vault/route.ts` 的 import + withDataPlane 写法）。
- [ ] **Step 3: 手动验证**：本地起 dev，`curl -X POST localhost:8080/api/vault/dedup -d '{"action":"scan"}'`（无凭据时按数据面闸行为预期 401/403——验证路由接线与错误路径不 500）。
- [ ] **Step 4: Commit** `feat: 查重扫描/忽略与存储聚合 API（个人面）`

---

### Task 5: vault-query 扩展（tags/month 谓词 + 智能文件夹类型）

**Files:**
- Modify: `src/lib/vault-query.ts`、`src/lib/vault-query.test.ts`

**Interfaces（Produces）:**
- `VaultQuery` 增加 `tags?: string[]`（任一命中）、`month?: string`（"YYYY-MM"，按 `savedAt` 本地时区）
- `export type SmartFolder = { id: string; name: string; query: VaultQuery }`

- [ ] **Step 1: 失败测试**（tags 任一命中；month 匹配 `new Date(savedAt)` 的年月；两者与 text/source/author 叠加）
- [ ] **Step 2: 确认失败 → Step 3: 实现**（`item.tags.some(t => tags.includes(t))`；`const d = new Date(item.savedAt); `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}` === month）
- [ ] **Step 4: 通过 → Step 5: Commit** `feat: 纸匣标签/月份筛选与智能文件夹类型`

---

### Task 6: 智能文件夹进设置段（store + backup 往返）

**Files:**
- Modify: `src/lib/store.ts`（settings 类型 + 默认 + `smartFolders` 状态与 `addSmartFolder/removeSmartFolder` action）
- Modify: `src/lib/backup.ts`（`parseBackupSettings` 解析 + build 序列化，对齐 folderLabel 的写法：store.ts:351/378、backup.ts:192/230）
- Test: `src/lib/backup.test.ts`（往返用例）

- [ ] **Step 1: 失败测试**：build → parse 往返保留 `smartFolders: [{id:"f1",name:"风景",query:{tags:["landscape"]}}]`；脏数据（非数组/缺 name）解析为 `[]`。
- [ ] **Step 2: 确认失败 → Step 3: 实现**（解析函数 `parseSmartFolders(raw): SmartFolder[]`，逐项校验 id/name 为 string、query 为对象且字段合法才收）。
- [ ] **Step 4: 通过（含全量 pnpm test）→ Step 5: Commit** `feat: 智能文件夹随设置同步`

---

### Task 7: 纸匣页 UI——筛选条 + 智能文件夹 + 查重视图

**Files:**
- Modify: `src/routes/vault.tsx`
- Create: `src/components/vault-dedup.tsx`（查重视图组件）

**要点（实现时对照现有 vault.tsx 结构）:**
- [ ] 筛选条：`vaultAuthors` 同款新增 `vaultTags(items)` / `vaultMonths(items)`（vault-query.ts 导出，带测试）；标签 chips 多选 → `query.tags`；月份下拉 → `query.month`。
- [ ] 智能文件夹：侧栏区块列出 `smartFolders`，点击套用 query；「保存当前筛选为文件夹」按钮（生成 id `crypto.randomUUID()`）；条目可删。
- [ ] 查重视图：`VaultDedup` 组件——「扫描重复」按钮 → POST scan → 组列表（组内卡片并排，标注 source/距离）→ 每张卡「删除」（复用 `deleteVaultWork` + toast）/ 每组「忽略本对」（dismiss 后从列表消失）。空结果显示「没有发现重复」。扫描中显示进度（hashed/total）。
- [ ] 手动 QA（浏览器）：筛选、文件夹保存/套用/删除、扫描→忽略→重扫描不再现。
- [ ] Commit `feat: 纸匣筛选条/智能文件夹/查重视图`

---

### Task 8: /vault/stats 统计页

**Files:**
- Create: `src/routes/vault-stats.tsx`、`app/vault/stats/page.tsx`（`"use client"; export default VaultStatsPage;` 对照 app/vault/page.tsx 模式）
- Modify: `src/components/app-shell.tsx` 不动（stats 入口放纸匣页头部链接，避免动全局导航）

**要点:**
- [ ] 客户端聚合 `listVault()` meta：来源占比、画师 Top10、标签 Top10、按月时间线——CSS/SVG 条形（不引库）。
- [ ] `GET /api/vault/stats/storage` 拉 bySource/byAuthor 占用卡片（失败显示「服务端不可用」，不阻塞其余卡片）。
- [ ] 查重状态卡：`GET /api/vault/dedup` 的 hashed/total/groups 数 + 「去处理」链接回纸匣页查重视图。
- [ ] 手动 QA + Commit `feat: 纸匣统计页`

---

### Task 9: 收尾——全量验证 + docs + PR

- [ ] `pnpm typecheck && pnpm test && pnpm build` 全绿；`npx eslint` 改动文件无 error。
- [ ] docs 回写：`docs/05-模块设计说明.md`（纸匣模块补智能库小节）、`CHANGELOG.md` Unreleased 用户可见条目、spec 文件状态行改「已实现」。
- [ ] 分支 `feat/vault-smart-library` 开 PR，等 CI 绿（按用户口径直接合并）。

---

## Self-Review 记录

- Spec 覆盖：检索三件（Task 5/6/7）、查重全链（1/2/3/4/7）、统计四模块（8）、错误处理（1 webp-null、4 扫描分批、7 空结果）✓
- 占位符：无 TBD；Task 7/8 为 UI 任务，给出组件行为级要求与对照文件（UI 代码由实现按现有组件风格写，测试以手动 QA + 既有纯函数测试覆盖）。
- 类型一致：`clusterDupes` 返回 `{keys, maxDistance}[]` 在 Task 4 API 与 Task 7 UI 一致；`SmartFolder` 定义在 Task 5、消费在 6/7 ✓
- Spec 修正：表建在 vault-store SCHEMA 而非 migrations/0004（侦察结论，已写入 Global Constraints）。
