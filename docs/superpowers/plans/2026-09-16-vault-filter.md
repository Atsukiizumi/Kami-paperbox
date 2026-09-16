# 纸匣筛选纸 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 纸匣筛选从「站点 Chip + 作者 Select + 标签云」收成「页上已选笺 + 一张筛选纸」。

**Architecture:** 纯函数算出已选笺 / 可见标签 / 作者过滤；`VaultFilter` 负责钮、笺、桌面 Popover / 手机 Drawer；内芯 `VaultFilterBody` 只写一份。`vault.tsx` 继续持有 state，过滤语义不动。

**Tech Stack:** 现有 ToggleGroup、Popover、vaul Drawer、MonthPicker、Input、FilterChip。无新依赖。RTL：`@testing-library/react` + `src/test/dom.ts`。

**Spec:** `docs/superpowers/specs/2026-09-16-vault-filter-design.md`

## Global Constraints

- 不要再在纸匣顶栏摊站点 Chip + 作者 Select + 标签云。
- 不要把顶栏「切换图源」接到纸匣列表。
- 不要用 `Select` 做作者。
- 不要新表、新同步段、新 `VaultQuery` 字段。
- 不要新颜色、新图表库、新商业组件。
- 文案锁死：筛选 / 筛选 · N；筛选纸匣；选出匣里要看的，不影响顶栏在刷哪个站。；匣里的来源 / 作者 / 标签 / 收入月份 / 在匣里；按名字找作者；没有这个名字；在标签里找；清空筛选。
- 已选笺 `aria-label`：`去掉筛选：{文案}`。点笺清条件，不打开纸。
- 无「确定」按钮。选即生效。
- `VAULT_TAG_VISIBLE = 40`。取消 `.slice(0, 24)`。
- 作者/标签选项列表口径与现状相同：`pool = source === "all" ? all : all.filter(source)`（spec 后半句；不要用未切站的全库）。
- 无头像。不要从历史拼头像。
- 智能文件夹、查重、`window.prompt`、卡片题注三标签：不改。
- 文件头注释写清作用 / 用法 / 为什么。
- 测试：`node --experimental-strip-types --test src/lib/vault-filter.test.ts`；组件 `node --import tsx --test src/components/vault-filter.test.tsx`。commit：`git -c commit.gpgsign=false commit --no-gpg-sign`。
- 不要 git-add `docs/`。

## File map

| 文件 | 职责 |
| --- | --- |
| `src/lib/vault-filter.ts` | `vaultFilterSlips` / `applySlipClear` / `clearVaultFilter` / `visibleVaultTags` / `filterAuthorOptions` / `EMPTY_VAULT_FILTER` / `VAULT_TAG_VISIBLE` |
| `src/lib/vault-filter.test.ts` | 上述纯函数 |
| `src/components/vault-filter.tsx` | FilterChip、VaultTagRow、VaultFilterBody、VaultFilter（钮+笺+壳） |
| `src/components/vault-filter.test.tsx` | RTL：关闭态无作者 combobox；开纸见「匣里的来源」；点笺清站点 |
| `src/routes/vault.tsx` | 删掉页级站点/作者/标签控件；挂 `<VaultFilter />` |
| `CHANGELOG.md` | Unreleased 用户可见 |

---

### Task 1: 筛选笺与可见标签纯函数

**Files:**
- Create: `src/lib/vault-filter.ts`
- Test: `src/lib/vault-filter.test.ts`

**Interfaces:**
- Consumes: `Source`（`src/lib/types.ts`）、`siteLabel` / `SITE_LIST`（`src/lib/sites.ts`）、`AuthorOption`（`src/lib/storage/vault-query.ts`）
- Produces:

```ts
export const VAULT_TAG_VISIBLE = 40;

export type VaultFilterState = {
  source: Source | "all";
  authorKey: string;
  tags: string[];
  month: string;
  unreadOnly: boolean;
  recallOnly: boolean;
};

export const EMPTY_VAULT_FILTER: VaultFilterState = {
  source: "all",
  authorKey: "",
  tags: [],
  month: "",
  unreadOnly: false,
  recallOnly: false,
};

export type VaultFilterSlip = {
  kind: "source" | "author" | "tag" | "month" | "unread" | "recall";
  key: string;
  label: string;
};

export function vaultFilterSlips(
  state: VaultFilterState,
  ctx: { authorName: string },
): VaultFilterSlip[];

export function applySlipClear(state: VaultFilterState, slip: VaultFilterSlip): VaultFilterState;

export function clearVaultFilter(state: VaultFilterState): VaultFilterState; // 等价 EMPTY；text 不在 state 里

export function visibleVaultTags(
  orderedByFreq: string[],
  selected: string[],
  query: string,
  limit?: number,
): string[];

export function filterAuthorOptions(options: AuthorOption[], query: string): AuthorOption[];
```

`vaultFilterSlips` 顺序锁死：source → author → 每个 tag → month → unread → recall。`source === "all"` 不出笺。author 笺 `label = ctx.authorName`，`key = authorKey`。tag 笺 `key` 与 `label` 都是标签原文。month 笺 `label` 用 `YYYY-MM` 原样。

`applySlipClear`：source → `all`；author → `authorKey=""`；tag → 从 `tags` 去掉 `slip.key`；month → `""`；unread/recall → `false`。

`visibleVaultTags`：
- `query.trim()` 非空：`orderedByFreq` 里名字包含 query（大小写不敏感）的全部，**不**截 40。
- query 空：已选全部（保持 selected 顺序）排前，再按 `orderedByFreq` 补未选，总数 `max(limit, selected.length)`，默认 limit=40。

`filterAuthorOptions`：query 空返回原数组；否则 `option.name.toLowerCase().includes(q)`。

- [ ] **Step 1: Write the failing test**

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import type { AuthorOption } from "./storage/vault-query.ts";
import {
  applySlipClear,
  clearVaultFilter,
  EMPTY_VAULT_FILTER,
  filterAuthorOptions,
  VAULT_TAG_VISIBLE,
  vaultFilterSlips,
  visibleVaultTags,
  type VaultFilterState,
} from "./vault-filter.ts";

const base: VaultFilterState = { ...EMPTY_VAULT_FILTER };

test("无条件 → 无笺；N 用 slips.length", () => {
  assert.deepEqual(vaultFilterSlips(base, { authorName: "" }), []);
});

test("笺顺序：站点、作者、各标签、月份、未读、今日去年", () => {
  const slips = vaultFilterSlips(
    {
      source: "pixiv",
      authorKey: "pixiv:1",
      tags: ["猫", "原创"],
      month: "2026-09",
      unreadOnly: true,
      recallOnly: true,
    },
    { authorName: "画师A" },
  );
  assert.deepEqual(
    slips.map((s) => [s.kind, s.label]),
    [
      ["source", "Pixiv"],
      ["author", "画师A"],
      ["tag", "猫"],
      ["tag", "原创"],
      ["month", "2026-09"],
      ["unread", "未读"],
      ["recall", "今日去年"],
    ],
  );
});

test("点笺清掉对应条件，其它不动", () => {
  const state: VaultFilterState = {
    source: "yande",
    authorKey: "a",
    tags: ["x", "y"],
    month: "2026-01",
    unreadOnly: true,
    recallOnly: true,
  };
  assert.equal(applySlipClear(state, { kind: "source", key: "yande", label: "Yande" }).source, "all");
  assert.equal(applySlipClear(state, { kind: "author", key: "a", label: "n" }).authorKey, "");
  assert.deepEqual(applySlipClear(state, { kind: "tag", key: "x", label: "x" }).tags, ["y"]);
  assert.equal(applySlipClear(state, { kind: "month", key: "2026-01", label: "2026-01" }).month, "");
  assert.equal(applySlipClear(state, { kind: "unread", key: "unread", label: "未读" }).unreadOnly, false);
  assert.equal(applySlipClear(state, { kind: "recall", key: "recall", label: "今日去年" }).recallOnly, false);
});

test("清空筛选复位六项", () => {
  assert.deepEqual(
    clearVaultFilter({
      source: "pixiv",
      authorKey: "k",
      tags: ["t"],
      month: "2026-09",
      unreadOnly: true,
      recallOnly: true,
    }),
    EMPTY_VAULT_FILTER,
  );
});

test("visibleVaultTags：空搜索已选优先且补到 40；有搜索不截断", () => {
  const freq = Array.from({ length: 50 }, (_, i) => `t${i}`);
  const selected = ["t49", "extra"];
  const closed = visibleVaultTags(freq, selected, "");
  assert.equal(closed[0], "t49");
  assert.equal(closed[1], "extra");
  assert.equal(closed.length, VAULT_TAG_VISIBLE);
  assert.ok(closed.includes("t0"));
  const q = visibleVaultTags(freq, selected, "T4");
  assert.ok(q.includes("t4") && q.includes("t40") && q.includes("t49"));
  assert.equal(q.length, freq.filter((t) => t.toLowerCase().includes("t4")).length);
});

test("filterAuthorOptions 按展示名", () => {
  const opts: AuthorOption[] = [
    { key: "1", name: "Alice", count: 2 },
    { key: "2", name: "阿布", count: 1 },
  ];
  assert.equal(filterAuthorOptions(opts, "").length, 2);
  assert.deepEqual(filterAuthorOptions(opts, "alice").map((o) => o.key), ["1"]);
  assert.equal(filterAuthorOptions(opts, "不存在").length, 0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --experimental-strip-types --test src/lib/vault-filter.test.ts`

Expected: FAIL，模块不存在。

- [ ] **Step 3: Write minimal implementation**

`src/lib/vault-filter.ts` 文件头：

```ts
/**
 * 纸匣筛选笺与纸内列表的纯函数。
 *
 * 作用：从筛选 state 算出页上已选笺、点笺后的 state、纸内可见标签/作者。
 * 用法：VaultFilter 关闭态用 vaultFilterSlips；标签段用 visibleVaultTags。
 * 为什么：笺顺序和 40 条上限写进单测，避免 UI 里再摊站点 Chip。
 */
```

`siteLabel` 只在 `source !== "all"` 时调用（`all` 不是 `Source`）。

`visibleVaultTags` 实现要点：先 `uniq` 已选（只保留一次），再追加 `orderedByFreq` 里未出现过的；无 query 时 `slice(0, Math.max(limit, selectedUniq.length))`。

- [ ] **Step 4: Run tests**

Run: `node --experimental-strip-types --test src/lib/vault-filter.test.ts`

Expected: PASS，exit 0。

- [ ] **Step 5: Commit**

```bash
git add src/lib/vault-filter.ts src/lib/vault-filter.test.ts
git -c commit.gpgsign=false commit --no-gpg-sign -m "feat: 纸匣筛选笺与可见标签纯函数"
```

---

### Task 2: VaultFilter 组件

**Files:**
- Create: `src/components/vault-filter.tsx`
- Test: `src/components/vault-filter.test.tsx`
- Move: `FilterChip`、`VaultTagRow` 从 `src/routes/vault.tsx` 进本文件（本任务先复制到新文件并导出；Task 3 再删 vault.tsx 里的旧定义）

**Interfaces:**
- Consumes: Task 1 全部导出；`ToggleGroup`/`ToggleGroupItem`；`Popover`/`PopoverTrigger`/`PopoverContent`；`Drawer` from `vaul`（对照 `src/routes/settings.tsx` 77–106 行：`Drawer.Root` / `Portal` / `Overlay` class `kami-veil-in fixed inset-0 z-50 bg-overlay` / `Content` class `kami-drawer-content` + `kami-drawer-grabber`）；`Input`；`MonthPicker`；`Button`；`SITE_LIST`；`formatBytes`
- Produces:

```tsx
export function VaultFilter(props: {
  value: VaultFilterState;
  onChange: (next: VaultFilterState) => void;
  authors: AuthorOption[];
  tagOptions: string[];
  totals: { count: number; bytes: number };
  showUnread: boolean;
  showRecall: boolean;
}): JSX.Element;

export function VaultFilterBody(props: {
  value: VaultFilterState;
  onChange: (next: VaultFilterState) => void;
  authors: AuthorOption[];
  tagOptions: string[];
  showUnread: boolean;
  showRecall: boolean;
  authorQuery: string;
  onAuthorQuery: (q: string) => void;
  tagQuery: string;
  onTagQuery: (q: string) => void;
}): JSX.Element;

export function FilterChip(props: {
  active: boolean;
  onClick: () => void;
  children: string;
  "aria-label"?: string;
}): JSX.Element;
```

壳分流：`window.matchMedia("(min-width: 768px)").matches` 为真用 Popover，否则 Drawer。jsdom 默认 `matches: false`，测试走 Drawer。

关闭态 DOM（`main` 内，由调用方保证）：

```tsx
<div className="flex flex-wrap items-center gap-2">
  <Button type="button" size="sm" variant="secondary" className="rounded-full" aria-expanded={open} onClick={() => setOpen(true)}>
    {slips.length > 0 ? `筛选 · ${slips.length}` : "筛选"}
  </Button>
  {slips.map((slip) => (
    <FilterChip
      key={`${slip.kind}:${slip.key}`}
      active
      aria-label={`去掉筛选：${slip.label}`}
      onClick={() => onChange(applySlipClear(value, slip))}
    >
      {slip.label}
    </FilterChip>
  ))}
  <span className="ml-auto text-xs tabular-nums text-subtle">
    {totals.count} 条 · {formatBytes(totals.bytes)}
  </span>
</div>
```

点笺 **只** `onChange(applySlipClear)`，不要 `setOpen(true)`。

筛选钮：桌面是 `PopoverTrigger asChild`；手机是 `onClick` 开 Drawer。两套不要同时挂两个可点的「筛选」——用 `md` 分支渲染一个钮。

`VaultFilterBody` 结构：

```tsx
<div className="space-y-5 p-4">
  <header>
    <h2 className="font-display text-base text-fg">筛选纸匣</h2>
    <p className="mt-1 text-sm text-muted">选出匣里要看的，不影响顶栏在刷哪个站。</p>
  </header>
  {/* 匣里的来源：ToggleGroup，value=source，onValueChange 里 v && onChange({...value, source: v as ...}) */}
  {/* 作者：authors.length===0 则整段不渲染。Input placeholder 按名字找作者。名单 filterAuthorOptions。空列表：没有这个名字 */}
  {/* 标签：tagOptions.length===0 不渲染。Input 在标签里找。VaultTagRow tags={visibleVaultTags(tagOptions, value.tags, tagQuery)} */}
  {/* 收入月份：MonthPicker value=month onChange */}
  {/* 在匣里：!(showUnread||showRecall) 则无。未读/今日去年 FilterChip，再点取消 */}
  <button type="button" className="text-sm text-muted underline-offset-2 hover:underline" onClick={() => onChange(clearVaultFilter(value))}>
    清空筛选
  </button>
</div>
```

作者行：

```tsx
<button
  type="button"
  className={cn("flex w-full items-center justify-between rounded-lg px-3 py-2 text-left", selected && "bg-accent/15 text-fg")}
  onClick={() => onChange({ ...value, authorKey: selected ? "" : option.key })}
>
  <span className="truncate">{option.name}</span>
  <span className="tabular-nums text-subtle">{option.count}</span>
</button>
```

`authorName` 给 slips：`authors.find(a => a.key === value.authorKey)?.name ?? ""`。

PopoverContent：`className="w-[min(24rem,calc(100vw-2rem))] p-0"`（覆盖默认 `w-72`）。Drawer.Title 文案「筛选纸匣」；body 里 h2 在抽屉里改成 `sr-only` 或省略以免双标题——**抽屉只用 `Drawer.Title`，桌面 Popover 用 h2**。把标题抽成 prop `heading: "dialog" | "page"`，`dialog` 时不渲染 h2（Drawer.Title 已有）。

手机 Drawer 打开时 `VaultFilter` 仍显示关闭态那一行（筛选钮 + 笺）。

`VaultTagRow` 从 vault.tsx 原样搬来（含 `max-h-9` / 展开 / 收起 / 已选排前）。FilterChip 增加可选 `aria-label`。

- [ ] **Step 1: Write the failing RTL test**

`src/components/vault-filter.test.tsx` 第一行 `import "../test/dom.ts";`

```tsx
import "../test/dom.ts";
import assert from "node:assert/strict";
import { describe, it, beforeEach } from "node:test";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { EMPTY_VAULT_FILTER, type VaultFilterState } from "@/lib/vault-filter";
import { VaultFilter } from "./vault-filter.tsx";

function Harness() {
  const React = require("react") as typeof import("react");
  const [value, setValue] = React.useState<VaultFilterState>(EMPTY_VAULT_FILTER);
  return (
    <main>
      <VaultFilter
        value={value}
        onChange={setValue}
        authors={[{ key: "pixiv:1", name: "画师A", count: 3 }]}
        tagOptions={["猫", "原创"]}
        totals={{ count: 10, bytes: 1024 }}
        showUnread
        showRecall
      />
    </main>
  );
}
```

不要用 `require("react")`。写成正式函数组件：

```tsx
import { useState } from "react";

function Harness({ initial = EMPTY_VAULT_FILTER }: { initial?: VaultFilterState }) {
  const [value, setValue] = useState(initial);
  return (
    <main>
      <VaultFilter
        value={value}
        onChange={setValue}
        authors={[{ key: "pixiv:1", name: "画师A", count: 3 }]}
        tagOptions={["猫", "原创"]}
        totals={{ count: 10, bytes: 1024 }}
        showUnread
        showRecall
      />
    </main>
  );
}

describe("VaultFilter", () => {
  beforeEach(() => cleanup());

  it("关闭态只有筛选钮和计数，没有作者 combobox，没有匣里的来源", () => {
    render(<Harness />);
    assert.ok(screen.getByRole("button", { name: "筛选" }));
    assert.equal(screen.queryByRole("combobox"), null);
    assert.equal(screen.queryByText("匣里的来源"), null);
    assert.match(screen.getByText(/条/), /10 条/);
  });

  it("点筛选出现筛选纸匣与匣里的来源；选 Pixiv 后面上出现笺", () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "筛选" }));
    assert.ok(screen.getByText("筛选纸匣"));
    assert.ok(screen.getByText("匣里的来源"));
    fireEvent.click(screen.getByRole("radio", { name: "Pixiv" }) || screen.getByRole("button", { name: "Pixiv" }));
    // ToggleGroupItem 的角色是 radio
    const pixiv = screen.getByRole("radio", { name: "Pixiv" });
    fireEvent.click(pixiv);
    assert.ok(screen.getByRole("button", { name: "去掉筛选：Pixiv" }));
    assert.match(screen.getByRole("button", { name: /筛选/ }).textContent ?? "", /筛选 · 1/);
  });

  it("点笺清掉站点且不要求纸仍打开", () => {
    render(<Harness initial={{ ...EMPTY_VAULT_FILTER, source: "pixiv" }} />);
    const slip = screen.getByRole("button", { name: "去掉筛选：Pixiv" });
    fireEvent.click(slip);
    assert.equal(screen.queryByRole("button", { name: "去掉筛选：Pixiv" }), null);
    assert.equal(screen.getByRole("button", { name: "筛选" }).getAttribute("aria-expanded"), "false");
  });
});
```

ToggleGroupItem 在 Radix 里是 `radio`。若测试里角色不是 radio，改成 `getByText("Pixiv")` 在纸打开后点第二个 Pixiv（笺出现前页上没有 Pixiv 按钮）。关闭态不应有 Pixiv Chip。

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test src/components/vault-filter.test.tsx`

Expected: FAIL，找不到模块或「筛选」。

- [ ] **Step 3: Implement `vault-filter.tsx`**

对照 `settings.tsx` 的 Drawer 样板。`open` 用 `useState(false)`。`useEffect` 订阅 `matchMedia("(min-width: 768px)")` 决定壳；测试里 matches=false → Drawer。

作者/标签 query 是组件内 state，关纸不必清（YAGNI）；`清空筛选` 只清 `VaultFilterState`，可顺带把两个 query 设 `""`。

- [ ] **Step 4: Run tests**

```bash
node --experimental-strip-types --test src/lib/vault-filter.test.ts
node --import tsx --test src/components/vault-filter.test.tsx
```

Expected: 全 PASS。若 ToggleGroup 角色不是 radio，只改测试查询，不改成 FilterChip。

- [ ] **Step 5: Commit**

```bash
git add src/components/vault-filter.tsx src/components/vault-filter.test.tsx
git -c commit.gpgsign=false commit --no-gpg-sign -m "feat: 纸匣筛选纸组件（笺 + ToggleGroup + 作者名单）"
```

---

### Task 3: 接到 `/vault`

**Files:**
- Modify: `src/routes/vault.tsx`

**Interfaces:**
- Consumes: `VaultFilter`、`VaultFilterState`
- Produces: 纸匣页关闭态不再有作者 `Select`、页级站点 Chip、页级 `VaultTagRow`

改动要点：

1. 删掉 `import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue }`（若本文件不再用）。
2. 删掉本文件底部的 `function VaultTagRow` 和 `function FilterChip`。
3. `tagOptions` 改为：

```ts
const tagOptions = useMemo(() => {
  const pool = source === "all" ? all : all.filter((item) => item.source === source);
  return vaultTags(pool);
}, [all, source]);
```

（作者 `authors` 已按 pool 算，不要改口径。）

4. 搜索框下一行只挂：

```tsx
<VaultFilter
  value={{
    source,
    authorKey: author,
    tags: tagsSel,
    month,
    unreadOnly,
    recallOnly,
  }}
  onChange={(next) => {
    setSource(next.source);
    setAuthor(next.authorKey);
    setTagsSel(next.tags);
    setMonth(next.month);
    setUnreadOnly(next.unreadOnly);
    setRecallOnly(next.recallOnly);
  }}
  authors={authors}
  tagOptions={tagOptions}
  totals={totals}
  showUnread={unreadKeys.size > 0}
  showRecall={recallTotal > 0}
/>
```

5. 删掉原来的站点 Chip 行、作者 Select、MonthPicker、页级未读/今日去年 Chip、页级标签行、右侧计数（计数已在 VaultFilter 里）。
6. **保留** 智能文件夹那一行 + 查重按钮（`filterActive` / `addSmartFolder` / `window.prompt` 不动）。
7. 页头「去年的今天」笺（header 里那枚 `.kami-slip`）保留，它不是筛选条。
8. `?unread=1` / `?recall=1` 的 `useEffect` 不改。

- [ ] **Step 1: 改 vault.tsx**（按上面 1–8，没有单独失败测试；用 Task 2 的组件测 + typecheck）

- [ ] **Step 2: typecheck + 纯函数/组件测**

```bash
pnpm typecheck
node --experimental-strip-types --test src/lib/vault-filter.test.ts src/lib/storage/vault-query.test.ts
node --import tsx --test src/components/vault-filter.test.tsx
```

Expected: 全 exit 0。`vault.tsx` 不得再出现 `SelectTrigger` 或 `slice(0, 24)`。

- [ ] **Step 3: Commit**

```bash
git add src/routes/vault.tsx
git -c commit.gpgsign=false commit --no-gpg-sign -m "feat: 纸匣页改用筛选纸，去掉作者下拉"
```

---

### Task 4: 收尾

**Files:**
- Modify: `CHANGELOG.md`

- [ ] **Step 1: Unreleased「变更」加一条（用户口吻）**

```md
- 纸匣筛选收进一张筛选纸：页上只留已选条件笺；站点改成和浏览一样的滑块组，作者改成可搜名单（不再用下拉），标签在纸里折叠挑选。顶栏切站仍然只影响浏览，不改匣里的来源。
```

若已有案头/标签折叠条目，追加在「变更」下，不要另开版本号。

- [ ] **Step 2: 门禁**

```bash
pnpm typecheck
pnpm test
pnpm lint
```

`pnpm test` 若只在 `scripts/with-app-env.test.mjs` PATH 上失败（Windows 既有），记录为既有问题，不要为它改筛选。typecheck 与 `src/lib/vault-filter.test.ts`、`src/components/vault-filter.test.tsx`、`vault-query.test.ts` 必须绿。

- [ ] **Step 3: 浏览器看一眼（有 dev 则）**

桌面 1280：纸匣未筛选时搜索下只有「筛选」+ 计数；点开纸见「匣里的来源」；选 Pixiv 后页上出现 Pixiv 笺；顶栏切 Yande，Pixiv 笺仍在。390：筛选从底部抽出。不要作者下拉。

- [ ] **Step 4: Commit**

```bash
git add CHANGELOG.md
git -c commit.gpgsign=false commit --no-gpg-sign -m "docs: CHANGELOG 纸匣筛选纸"
```

不要 push / 不要开 PR（交给编排者）。不要 git-add `docs/`。

---

## Self-Review

**Spec coverage**

| Spec | Task |
| --- | --- |
| 关闭态搜索 + 筛选钮 + 已选笺 + 计数 | 2、3 |
| 笺顺序与点掉语义 | 1 |
| 桌面 Popover / 手机 Drawer / 同一 Body | 2 |
| ToggleGroup 站点、「匣里的来源」 | 2 |
| 作者名单禁止 Select、无头像、搜索 | 1、2 |
| 标签折叠、取消 24、可见 40 | 1、2、3 |
| MonthPicker、未读/今日去年进纸 | 2、3 |
| 清空筛选不清搜索框 | 1 `VaultFilterState` 无 text；3 搜索独立 |
| 智能文件夹不改 | 3 |
| 顶栏图源不联动 | 3 不改 app-shell |
| 无确定按钮 | 2 |
| 文案锁死 | 2 |
| 作者 Select 不在 main | 2 测试 + 3 |
| CHANGELOG | 4 |

**Placeholder scan:** 无 TBD。ToggleGroup 角色以 Radix `radio` 为准，测试可改为 `getByText` 但不得改回 Chip。

**Type consistency:** `VaultFilterState` / `VaultFilterSlip` / `onChange(next: VaultFilterState)` 三任务同名。vault.tsx 的 `author` state 仍是簇键字符串，映射为 `authorKey`。
