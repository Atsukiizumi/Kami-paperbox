# 今日案头（主页）设计

日期：2026-09-15 · 状态：待实现
来源：头脑风暴（案头 / 来信 / 一纸两面 / 透台 / 未读纸叠）；本刀只做案头主页
基线：发版 0.10.3（`main@022c064` 附近）

## 目标与非目标

**做**：把 `/` 换成一张「今日稿纸」主页；现有浏览整页搬到 `/browse`。打开应用、点 Logo 落到案头。第一刀四块：去浏览（纯字）、今日报纸（现场拉当前站日榜前 4 张）、未拆信（不现场检查）、未读纸叠 / 去年今日笺（有才出现）。

**不做（本刀）**

- 一纸两面（跨站同作归并）：想法保留，一般不会出现双记录，不实现
- 透台（灯箱叠图对照）：必须另开讨论，本刀不设计不实现
- 把 `/watch` 改成来信界面、纸叠抽一张的翻牌交互
- 去浏览里塞浏览流预览；案头打开时跑 `checkWatchArtists`
- 新表、新同步段、新设置字段、智能文件夹新条件
- 手机底栏第七格；把「浏览」从六格里换掉
- 静物桌、散落纸片、仪表盘六卡、新图表库、新商业组件

后续刀（不在本 spec 验收）：来信页改版、纸叠抽纸、透台（先讨论）、一纸两面（择机）。

## 已拍板

| 决策 | 选择 |
| --- | --- |
| `/` | 案头 |
| 浏览 | `/browse`，保活跟着走 |
| 手机底栏 | 六格不动，第一格仍是浏览 → `/browse`；案头只从打开应用 / Logo 进 |
| 气质 | 稿案（栏/笺/折角），不是静物桌，不是通知条 |
| 去浏览 | 纯字，不拉浏览流 |
| 报纸 | 现场拉当前站日榜；失败或 FANBOX 整栏不出现 |
| 来信 | 有追踪名单才出现；角标用上次 `kami-watch-badge`；点进 `/watch` 才检查 |
| 空块 | 不占位；右栏全空则去浏览拉满三列 |

## 架构

### 路径与壳

| 路径 | 渲染 |
| --- | --- |
| `/` | 案头（`app/page.tsx` → `DeskPage`）。壳 **渲染 children** |
| `/browse` | 现 `Home`，文件迁到 `src/routes/browse.tsx`（不再放 `index.tsx`）。壳 dynamic 改指向该文件并保活，**隐藏 children** 避免双挂 |

保活从 `pathname === "/"` 改成 `pathname === "/browse"`：

- 初始 `keepBrowse = (pathname === "/browse")`。冷打开 `/` **不**预挂浏览 chunk
- 进入 `/browse` → `keepBrowse = true`
- `/browse` → 作品 / 画师 / 创作者 / 合集：浏览继续挂、滚回原处（现逻辑，只改判定）
- `/browse` → **案头**（Logo）：浏览继续挂。案头 **不是** `isMainNavPath`，不卸网格
- `/browse` → 热榜 / 纸匣 / 设置 / 搜图 / 历史 / 队列：照旧 `isMainNavPath` 卸浏览
- `/`、`/browse`、`/watch` 都不进 `isMainNavPath`（`/watch` 现状已如此，保持）

`isActive`：

- `to === "/"`：仅 `pathname === "/"`
- `to === "/browse"`：`/browse` 以及 `/work` `/user` `/creator` 前缀（详情仍高亮浏览，不把详情算案头）
- 合集 `/pool` 维持现状（不高亮浏览）

导航：

- 桌面 `NAV` 最前插入 `{ to: "/", label: "案头", icon: BookOpen }`；原「浏览」改 `to: "/browse"`，图标仍 Compass
- `MOBILE_NAV` 过滤条件改为排除 `/`、`/queue`、`/watch`（案头不进六格）。人在 `/` 时 `mobileRawIndex < 0`，指示条已有 `opacity-0`，保持
- Logo → `/`
- `BackToBrowse`、空态「去浏览」、纸匣/统计/热榜/404 里指向浏览的链接 → `/browse`。找不到历史时 `BackToPrevious` 的 fallback 也改 `/browse`（详情的家是浏览，不是案头）

`KNOWN_ROUTE_PATHS` 增加 `"/browse"`。`isBrowsePath(pathname)` 加进 `route-shape.ts`：`pathname === "/browse"`。

`app/browse/page.tsx` 新建，组件可空或短壳（真正网格由壳保活渲染，与今天 `/` 丢弃 children 同一套路）。

### 组件边界

| 单元 | 做什么 | 怎么用 | 依赖 |
| --- | --- | --- | --- |
| `src/routes/desk.tsx` | 稿纸排版：页眉 + 四块显隐 | `/` 的 page | 下列块 + settings.tab |
| `src/lib/desk-unread.ts` | 未读判定纯函数 | 案头计数；纸匣过滤共用 | `VaultMeta[]` + `HistoryEntry[]` |
| `DeskNewspaper` | 日榜 4 缩略 | 案头里 | `fetchSource`，不复用 `home-pixiv` queryKey |
| `DeskLetters` | 未拆信文案 | 有 `watchArtists.length` 才挂 | settings + watch-badge |
| `DeskStack` | 未读纸叠 | 未读数 > 0 才挂 | desk-unread + listVault |

去浏览是 `Link to="/browse"` 包起来的主纸，不必独立文件。去年今日用已有 `onThisDay`，笺条点到 `/vault?recall=1`。

浏览大文件只搬家，不在本刀重构。

## 稿纸版式

内容区最大宽度 `max-w-6xl`（72rem），左对齐，桌面 `px-10` 手机 `px-4`（跟壳一致）。

桌面 `lg:grid-cols-3 gap-4`：

1. 页眉通栏：衬线「今日」+ 次要色本地日期（`2026年9月15日 · 星期二` 这种，用 `Intl`，不要再写产品名）
2. 去年今日命中时，页眉右侧或下一行一枚 `.kami-slip`，文案沿用纸匣：「去年的今天，你收了 N 张」。点 → `/vault?recall=1`
3. 去浏览 `lg:col-span-2`；右栏 `flex flex-col gap-4` 放信、纸叠（各自可缺）
4. 右栏两块都缺：去浏览改 `lg:col-span-3`
5. 报纸通栏 `lg:col-span-3`，在主纸下面

手机单列顺序：页眉 → 笺条（有则）→ 去浏览 → 报纸 → 信 → 纸叠。

全页只有去浏览一块用 `.kami-card-folded`。块面 `rounded-xl bg-surface`，纸影 `--shadow-paper-1`，不要 `Card` 六兄弟墙。手绘态不新开分支（标题字体 / 笺条微歪跟全局走）。

### 去浏览

- 整块进 `/browse`
- 桌面 `min-h-[17.5rem]`；标注「当前 · {siteLabel(tab)}」；衬线标题「去浏览」；一行 `text-muted`：「日榜、关注、推荐都在那边」
- 无图、无单独按钮
- 手机标题降到约 32px，靠内边距撑，不设死高度

### 今日报纸

- 栏名「今日报纸 · {站} 日榜」，点栏名 → `/rankings`
- 4 张竖图（`aspect-[3/4]`），`rounded-lg`，间隙 8px；点图 → `/work/$source/$id`
- 名次用左上角 `tabular-nums` 小字，**不用** `.kami-slip`（旋转会糊图）
- 不要作者/标题；不要整张 `ArtworkCard`（悬停托盘、折角、入队会把稿纸变成第二浏览页）
- 封面 `ProxiedImg`
- 手机：横向滚动，第 4 张露出一截；禁止 2×2
- 加载：4 个 `bg-surface` 色块；失败 / 空 / `tab === "fanbox"`：**整栏不渲染**（不要报错条）

### 未拆信

- `watchArtists.length === 0` 不渲染
- 整块 → `/watch`
- 标题「未拆的信」
- `newCount > 0`：`{n} 封 · {m} 张新作`。**封 = `watchArtists.length`**（桌上几封信），**张 = 上次角标**（不在案头重算）
- `newCount === 0`：`信都拆过了`，`text-muted`，仍可点
- 无头像墙、无新作缩略

### 未读纸叠

- 未读数 = 0 不渲染
- 整块 → `/vault?unread=1`
- 2–3 张 `bg-elevated` 矩形错位 4px（transform，不要 3D）
- 文案「未读 N 张」

## 数据流

零新持久化。案头只读已有源。

### 报纸

独立 `useQuery`，key：

```
["desk-newspaper", tab, safeMode, hideAi, credentialTag(cookie), dateIso]
```

不要用 `["home-pixiv", …]` / `["home-booru", …]`，以免和保活浏览抢同一查询。

- Pixiv：`fetchSource({ op: "pixivRanking", mode: "daily", page: 1, date: pixivRankingDateParam(todayIso), …creds })`。日期规则与浏览日榜相同（JST 当天未公布则不传 date）
- yande / konachan / danbooru：`op: "booruList", feed: "daily", page: 1, date: todayIso`
- FANBOX：`enabled: false`
- `dateIso` 与浏览默认日榜相同：`parseBoardDate().iso`（本地日历日）；Pixiv 再经 `pixivRankingDateParam`（JST 未公布则不传 date）
- 取 `items.slice(0, 4)`；成功则 `rememberRanking`（与浏览写归档同一副作用，失败吞掉）
- `staleTime` 对齐浏览缓存量级，不新造 TTL

### 未读

`src/lib/desk-unread.ts`（Node 可测）：

作品键：`` `${source}:${id}` ``。

一条藏品算未读，当且仅当：

1. `savedAt >= historyCutoff(now)`（90 天窗，与 `HISTORY_DAYS` 相同）。更早的历史已剪枝，**当作未知，不进纸叠**
2. 浏览历史里没有该键，**或** 该键的 `viewedAt < savedAt`（先看过再收、收下后再没打开）

从纸匣打开作品仍走现成 `rememberView`，下次回案头会掉出纸叠。不在 `VaultMeta` 上加 `openedAt`。

未读不进 `VaultQuery` / 智能文件夹（历史是本机浏览态，不是收藏条件）。

### 去年今日

已有 `onThisDay(items, now)`。案头与纸匣共用。N = 各组 `items.length` 之和。

### 纸匣深链

`/vault?recall=1`、`/vault?unread=1` 为初值，读完即可清 URL（`replaceState`），避免分享带瞬时过滤。纸匣加可关闭 chip「未读 ×」，叠在 `filterVaultItems` 之后，与「今日去年」相同手法。两 chip 可同时亮 → 交集。

`listVault` 失败当空数组，纸叠/笺都不出现。

### 来信

只读 `useSettings.watchArtists` 与 `useWatchBadge.newCount`。案头 **禁止** 调 `checkWatchArtists`。

## 错误处理

| 情况 | 行为 |
| --- | --- |
| 报纸 4xx/5xx/超时 | 整栏消失，不 toast（案头不是操作页） |
| 报纸 0 条 | 整栏消失 |
| FANBOX | 不请求，整栏消失 |
| 纸匣 / 历史未就绪 | 纸叠、笺先不画，就绪后再决定 |
| 无追踪 | 不画信 |
| 访客 / 未登录 | 报纸与去浏览照常（跟现浏览访客层）；纸匣空则无纸叠/笺；追踪空则无信 |
| 保活浏览仍在背后 | 案头自己的报纸查询与浏览网格互不影响 |

## 测试

纯函数（node:test，与 `vault-profile.test.ts` 同目录风格）：

- `unreadItems`：从未打开；打开早于 `savedAt`；打开晚于 `savedAt`（已读）；刚好在 90 天边界上/下；空库；历史有键但 vault 没有（不影响）
- `isBrowsePath`；`isActive` 抽纯函数测 `/` vs `/browse` vs `/work/…`（若现在写在 app-shell 里，把判定挪到 `route-shape.ts`）

E2E 改指浏览页（`/` 不再出瀑布流 `article`）：

- `e2e/critical-path.spec.ts`：`goto("/")` → `goto("/browse")`
- `e2e/guest-tier.spec.ts`：卡片断言改 `/browse`（报纸不用 `article`，留在 `/` 会假绿或假红）
- `e2e/browse-cache.spec.ts`：「回浏览页」改 `goto("/browse")`；先开 `/vault` 再回浏览的回归点不变

案头冒烟（可并进 critical-path 或短 spec）：冷打开 `/` 看得到「今日」和「去浏览」；点去浏览 URL 变 `/browse`。报纸有无上游不作为硬断言。

## 验收

- 打开应用落在案头；Logo 回案头；手机六格第一格是浏览且人在案头时无高亮
- `/browse` 瀑布流、站点切换、日榜/关注/推荐、保活滚回，与搬迁前一致
- 详情「返回浏览」到 `/browse` 且能滚回
- 从浏览点 Logo 到案头再点浏览，网格还在、滚动还在
- 冷打开案头，网络面板在点「去浏览」之前不加载浏览大 chunk
- 四块显隐符合「空不占位」；FANBOX 无报纸
- 案头不出现 `checkWatchArtists` 请求
- 未读定义与 90 天窗有单测；纸匣 `?unread=1` 亮「未读」chip
- `pnpm typecheck` / `pnpm test` / `pnpm lint` / `pnpm build` 绿
- CHANGELOG Unreleased 写用户可见变化；走 PR

## 文件（预期）

- 改：`src/components/app-shell.tsx`、`src/lib/route-shape.ts`、`src/lib/kami-link.tsx`、`src/components/back-to-browse.tsx`、`src/components/empty-sheet.tsx`、`src/components/not-found.tsx`、凡 `to="/"` 且语义是浏览的链接、`src/routes/vault.tsx`、`app/page.tsx`、e2e 三条、CHANGELOG
- 增：`app/browse/page.tsx`、`src/routes/desk.tsx`、`src/lib/desk-unread.ts` + `.test.ts`；报纸/信/纸叠可放 `src/components/desk/`
- 迁：`src/routes/index.tsx` → `src/routes/browse.tsx`（壳 dynamic import 改指向；`app/page.tsx` 不再从这里引 Home）

## GLM 出图（实现不阻塞）

桌面 1280 满/瘦各一，手机 390 满/瘦各一。约束见头脑风暴第二节：墨黑书案、无紫无霓虹无假桌、壳要画对（侧栏有案头+浏览，底栏六格无案头）。图只验收气质，代码以本文件为准。
