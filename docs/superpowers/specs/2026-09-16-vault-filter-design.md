# 纸匣筛选（站点 / 作者 / 标签）设计

日期：2026-09-16 · 状态：待实现（用户要求写成设计书，供其他智能体照做）
范围：只改 `/vault` 筛选条的呈现与交互。过滤语义、`VaultQuery`、智能文件夹、未读/今日去年算法都不动。
基线：`feat/desk-home` 上已有折叠标签行（`VaultTagRow`）、未读芯片、`?unread=1` / `?recall=1`。
上游气质：`docs/superpowers/specs/2026-09-14-paper-style-design.md`（折角是记号不是堆料；无紫无金光无 emoji；弹层走纸影 + `kami-drop-in`）。纸感 PR3 已点名「纸匣筛选面板」用 vaul，本设计把它落地。

## 给实现智能体（先读）

1. **不要**再在纸匣顶栏摊一排站点 Chip + 作者 Select + 标签云。那是现状，也是本设计要换掉的。
2. **不要**把顶栏「切换图源」接到纸匣列表。顶栏只改浏览/报纸；匣里的来源只看本设计的站点段。
3. **不要**用 `Select` 做作者。Select 在本仓库注释里就是「后台产品单选菜单」。作者用可搜名单。
4. **不要**新表、新同步段、新 `VaultQuery` 字段。未读仍是浏览历史派生，不进智能文件夹。
5. **不要**新颜色、新图表库、新商业组件。控件：已有 `ToggleGroup`、`Popover`、`vaul` Drawer、`MonthPicker`、`FilterChip` / `VaultTagRow`。
6. 本文件是契约。稿纸结构、文案、桌面/手机分流、验收，按下面各节做。走样先改文档再改代码。

## 问题（为何要改）

纸匣现在把三件不同的事挤成一条工具栏：

| 控件 | 现状 | 和项目 UI 的关系 |
| --- | --- | --- |
| 站点 | 自制 `FilterChip` 单选 | 浏览/历史已有带滑块的 `ToggleGroup`，纸匣另造一套 |
| 作者 | 圆角 `Select`（`名 · N`） | 后台下拉；历史页作者是名单纸片。`VaultMeta` 没有头像，不要发明头像 |
| 标签 | 最多 24 个 Chip，刚改成超一行折叠 | 多选印鉴是对的，但摊在页面上仍像 CMS 词云 |

顶栏站点切换在纸匣页仍然可见、却不滤匣，和 Chip「Pixiv」并排时会让人以为切了图源匣子也会变。

## 目标与非目标

**做**：纸匣筛选收成「页上的已选笺 + 一张筛选纸」。站点 / 作者 / 标签（加月份、未读、今日去年）在纸里选；页上只看到已生效的条件。

**不做**

- 改 `filterVaultItems` 语义、智能文件夹 schema、`window.prompt` 存文件夹
- 改卡片题注里的三个标签（那是作品上的印，不是筛选器）
- 顶栏图源与纸匣联动
- 命令面板、仪表盘、静物桌、新路由

## 已拍板

| 项 | 决定 |
| --- | --- |
| 信息架构 | 关闭态：搜索框 + **筛选**钮 + 已选笺。打开态：一张筛选纸 |
| 桌面 | `Popover` 锚定「筛选」，纸片落下（`kami-drop-in` / `shadow-paper-2` / `rounded-xl`） |
| 手机 | `vaul` `Drawer`，复用设置页的 `kami-drawer-content` / Overlay `kami-veil-in` |
| 站点 | `ToggleGroup` type=single，选项：全部 + `SITE_LIST`，文案用 `siteLabel` |
| 作者 | 纸内搜索 + 可滚动名单（名 + 张数）。**禁止 Select**。无头像（meta 没有） |
| 标签 | 纸内多选 Chip；超过一行折叠（现 `VaultTagRow` 行为）。纸外只展示**已选**笺。取消 24 上限，用纸内搜索收口 |
| 月份 | 仍用 `MonthPicker`，挪进筛选纸 |
| 未读 / 今日去年 | 仍是瞬态芯片，挪进筛选纸「在匣里」段；有才出现 |
| 智能文件夹 | 仍在筛选纸**下面**单独一行，本刀不改交互 |
| 顶栏图源 | 不改行为。筛选纸站点段小字标注「匣里的来源」 |

## 关闭态（纸匣页上能看见的）

搜索框保留，占满一行（现 `Input`）。

其下一行，从左到右：

1. **筛选** — `Button` `size="sm"` `variant="secondary"` `rounded-full`。有任一已选条件时用 `variant` 保持 secondary，但文字为「筛选 · N」（N = 已选条件条数，见下）。无条件时只写「筛选」。
2. **已选笺** — 每个条件一枚可点掉的圆角片（现成 `FilterChip` 的 active 态，或同等 `h-9 rounded-full bg-accent text-accent-fg`）。点笺 = 清掉该条件，不打开筛选纸。
3. 右侧仍是 `N 条 · {bytes}`（`ml-auto`）。

已选笺生成规则（有才出现，顺序固定）：

| 条件 | 笺文案 | 点掉之后 |
| --- | --- | --- |
| `source !== "all"` | `siteLabel(source)` | `source = "all"` |
| `authorKey` 非空 | 作者展示名（`vaultAuthorOptions` 的 `name`） | `author = ""` |
| 每个已选 tag | 标签原文 | 从 `tagsSel` 去掉该项 |
| `month` 非空 | `month` 原样（`YYYY-MM`）或 `MonthPicker` 现用展示 | `month = ""` |
| `unreadOnly` | `未读` | `unreadOnly = false` |
| `recallOnly` | `今日去年` | `recallOnly = false` |

N 的计数 = 上表出现的笺数（多个标签算多枚）。

不要在关闭态再摊未选的站点 Chip、作者下拉、标签云。

## 打开态（筛选纸）

衬线标题：**筛选纸匣**。副行 `text-sm text-muted`：**选出匣里要看的，不影响顶栏在刷哪个站。**

纸内分段，每段左或上放 `text-xs text-subtle` 标注（热榜「站点 / 榜单」同款），段间距 `space-y-5`，左右 `p-4`。桌面 Popover 宽 `w-[min(24rem,calc(100vw-2rem))]`；不要做成全屏仪表。

### 1. 站点

标注：**匣里的来源**

```tsx
<ToggleGroup type="single" value={source} onValueChange={(v) => v && setSource(v)}>
  <ToggleGroupItem value="all">全部</ToggleGroupItem>
  {SITE_LIST.map((s) => (
    <ToggleGroupItem key={s.id} value={s.id}>{s.label}</ToggleGroupItem>
  ))}
</ToggleGroup>
```

必须用浏览/历史那套带滑块的 `ToggleGroup`，不要 `FilterChip` 冒充。

### 2. 作者

标注：**作者**

- 作者数为 0：整段不渲染。
- 段顶一个 `Input`，placeholder **按名字找作者**，只滤展示名（含别名后的 `option.name`），大小写不敏感。
- 下面 `max-h-48 overflow-y-auto` 的名单。每行是 `button`，全宽，`rounded-lg px-3 py-2`，左名字、右 `tabular-nums text-subtle` 张数。选中：`bg-accent/15 text-fg`。再点已选 = 清掉作者（回到全部作者）。
- 名单数据：现成 `vaultAuthorOptions(all, authorAliases)`，**按当前匣全量**，不要按已选站点再切一刀（切站点后列表自然变短：实现时应用 `source` 过滤后的 `all` 子集算作者——与现状 `vaultAuthorOptions(pool)` 一致：`pool = source === "all" ? all : all.filter(source)`）。
- 无头像。禁止为了「好看」去历史里拼头像。
- 空搜索结果：一行 `text-sm text-muted` **没有这个名字**。

### 3. 标签

标注：**标签**

- 标签数为 0：整段不渲染。
- 段顶 `Input`，placeholder **在标签里找**。过滤 `vaultTags(all)`（或当前 source 子集，与作者同一 pool 口径）。
- 下面复用/挪出 `VaultTagRow`：超一行折叠、已选排前、展开/收起、清空。
- **取消 `.slice(0, 24)`**。搜索是上限的替代。无搜索词时仍可只渲染前 40 个高频 + 全部已选（已选必须在），避免一次挂几百 Chip；有搜索词则渲染全部命中。把 40 写成命名常量 `VAULT_TAG_VISIBLE = 40`。
- 多选语义不变：任一命中（现 `filterVaultItems` 的 `tags`）。

### 4. 时间

标注：**收入月份**

现成 `MonthPicker`。无月份选项或只有一个月时：仍渲染，让人能回到「全部时间」。

### 5. 在匣里

仅当 `unreadKeys.size > 0` 或 `recallTotal > 0` 时出现。标注：**在匣里**。

未读 / 今日去年仍是可开关 Chip（文案与现芯片相同，含 `未读 ×` / `今日去年 ×` 的选中写法也可改成选中态不带叉——点笺已能清。纸内用 Toggle 更干净：选中即 active Chip，再点取消）。

两条件可同时亮，过滤仍是交集（现状）。

### 纸底

左：**清空筛选**（`text-sm text-muted underline`），把 source/author/tags/month/unread/recall 全部复位。搜索框（找作品的那条）不清。  
右：无主按钮。选即生效，关纸即回到匣。不要「确定」。

## 桌面 / 手机

| | 桌面 `md+` | 手机 |
| --- | --- | --- |
| 容器 | `Popover` 锚定筛选钮 | `Drawer.Root` + `Drawer.Content.kami-drawer-content` |
| 进场 | `kami-drop-in` | 现设置抽屉同款 |
| 关闭 | 点外面 / Esc | 下滑 / 点遮罩 |
| 标题 | 纸内 h2 | `Drawer.Title` 同样文案 |

同一套内芯组件 `VaultFilterBody`，两套壳。不要复制两份站点/作者/标签 JSX。

`md` 断点与 Tailwind 默认一致（768）。不要自己发明 640。

## 数据与状态

仍全部活在 `VaultPage` 的 useState + 现成 hooks：

- `text` 搜索框（页上，不进筛选纸）
- `source` / `author` / `tagsSel` / `month` / `unreadOnly` / `recallOnly`
- `?unread=1` / `?recall=1` 初值逻辑不改

`VaultQuery` 不改。智能文件夹读写字段不改。

## 组件边界

| 单元 | 做什么 | 依赖 |
| --- | --- | --- |
| `src/components/vault-filter.tsx` | 筛选钮 + 已选笺 + 桌面 Popover / 手机 Drawer 壳 + `VaultFilterBody` | ToggleGroup、Input、MonthPicker、FilterChip |
| `VaultTagRow` | 从 `vault.tsx` 挪到 `vault-filter.tsx`（或旁文件），行为不变 | ResizeObserver、一行 `max-h-9` |
| `src/routes/vault.tsx` | 删掉站点 Chip 行、作者 Select、页级标签云；头下只留搜索、`<VaultFilter … />`、智能文件夹行、查重 | 把 state 通过 props 交给 VaultFilter |

`FilterChip` 可留在 `vault.tsx` 或一并挪走。不要第三套 Chip 样式。

## 文案锁死

- 钮：筛选 / 筛选 · N
- 纸题：筛选纸匣
- 副行：选出匣里要看的，不影响顶栏在刷哪个站。
- 段标：匣里的来源 / 作者 / 标签 / 收入月份 / 在匣里
- 作者搜索：按名字找作者；空：没有这个名字
- 标签搜索：在标签里找
- 纸底：清空筛选
- 展开/收起：沿用标签行

## 动效与无障碍

- 只动 transform/opacity；`prefers-reduced-motion` 全归零（全局已有则不要新 keyframes）。
- 筛选钮 `aria-expanded`。纸：桌面用 Popover 焦点阱；抽屉用 `Drawer.Title`。
- 已选笺 `aria-label`：`去掉筛选：{文案}`。
- 点笺清条件时不要打开纸。

## 测试

- `filterVaultItems` 不因本刀失败（现测不动）。
- 组件：打开筛选纸能看到「匣里的来源」；选 Pixiv 后面上出现 Pixiv 笺；点笺 source 回到 all。作者 Select 不再出现在纸匣页（`getByRole('combobox', {name: …})` 不再指向作者——顶栏图源 combobox 仍在，断言要限定在 main 里）。
- 标签：多于一行出现「展开」；点开出现「收起」。
- 不要 e2e 打真实匣数据当硬依赖；RTL + 纸匣页浅渲染即可。

## 验收

- 纸匣打开不再出现作者下拉箭头菜单。
- 未筛选时，搜索框下只有「筛选」和计数，没有一排站点/标签。
- 选了站点或作者或标签，页上出现对应笺；点笺即取消，列表马上变。
- 桌面点筛选弹出纸片，不跳页；手机从底升起抽屉。
- 顶栏切 Yande，匣里的来源笺不变；只有纸里改「匣里的来源」才滤。
- 智能文件夹、查重、随手翻一张、导出、统计仍在。
- `pnpm typecheck` / 相关单测绿。CHANGELOG Unreleased 写用户可见变化。

## 明确留给以后

- 智能文件夹改成笺、去掉 `window.prompt`
- 作者头像（要先有数据）
- 顶栏图源与匣联动（默认不做）
