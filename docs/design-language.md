# 纸格设计语言 · 权威规范（v1）

> 唯一信源：`preview/kami-ia.html`（Grok 会话 01a1742d 定稿样张）。
> 本文档是逐条临摹提取，不是转述。项目内一切界面改动以本文为准；样张与本文冲突时以样张为准并回改本文。
> 2026-10-26 提取校准。

## 1. 色彩 token（双层墨：纸/案）

| Token | 纸（亮） | 案（暗） | 用途 |
|---|---|---|---|
| `--bg` | `#f3efe8` | `#0e0d0c` | 页面底 |
| `--fg` | `#141210` | `#f3efe8` | 正文/标题 |
| `--muted` | `#5e5954` | `#a39c93` | 次级文字 |
| `--line` | `rgb(fg 14%)` | `rgb(fg 14%)` | 发丝线（一切分割线/边框） |
| `--line-strong` | `rgb(fg 34%)` | `rgb(fg 32%)` | 结构线（装饰圆/折角） |
| `--paper` | `#e7dfd2` | `#1b1916` | 纸背（卡片面/图块底） |
| `--paper-2` | `#f7f3ec` | `#26231f` | 二层纸（骨架/悬浮层） |
| `--seal` | `#8f3d32` | `#e8a09a` | 印泥红（日期章/未读/收入纸匣，仅此三处） |

**朱红纪律不变**：全页只允许日期章、未读计数、「收入纸匣」三个语义位用 `--seal`。

## 2. 字体（仅两族，无 mono）

- `--serif` = `"Newsreader", "Noto Serif SC", "Songti SC", serif` — 展示标题（h1 级：`font-weight 560; letter-spacing -0.045em; line-height 0.84`）与**当前态**。
- `--sans` = `"Noto Sans SC", "Microsoft YaHei", sans-serif` — 正文与标签。
- **当前/激活态 = 衬线斜体 + fg 色**（`.modes button[aria-current="true"]` 等），不用底色药丸。
- 标签 = `--sans` 11px + `letter-spacing 0.14–0.18em`。**禁止等宽字体做标签**（批一~三的 mono 标签是偏差，校准项）。
- 大标题字距体系：`0.14 / 0.16 / 0.18 / 0.28 / 0.42em` 五档。

## 3. 线与形

- **圆角纪律：全局 0；唯一的圆 = 圆本身**（日期章 92px 正圆、装饰圆环、8px 圆点）。批一的方形日期章是偏差，校准项。
- 一切分割 = `1px solid var(--line)`；结构装饰 = `1px solid var(--line-strong)`。
- **零阴影**：全站无 box-shadow（含卡片、浮层、悬浮胶囊）。
- 视口骨架：外框 `inset 12px` 发丝框 + 左竖线 112px；左栏宽 88px。
- 浮层（笺/印）：贴右缘整高面板，纸色底 + 左边线，进出 `transform .7s var(--ease)`。

## 4. 动效

- 唯一缓动：`--ease: cubic-bezier(0.16, 1, 0.3, 1)`。
- 时长档：**0.45s**（色彩/状态）、**0.7s**（抽屉/面板）、**0.95–1.2s**（进场）。
- **进场 = clip-path 自下而上揭起**（`inset(100% 0 0 0) → inset(0)`），逐格 stagger 0.05–0.22s——批二 v2 改成的「落纸 settle 8px」是偏差，校准项（样张Scheme A 的签名动效就是帘幕揭起）。
- **hover = 变色不变位**（`background/color .45s`）；批三的卡片 translateY(-2px) 抬升是偏差，校准项。
- 关停：`html[data-motion="off"]` 下 `transition/animation: none !important`。

## 5. 组件语法对照（样张 → 项目）

| 样张元素 | 项目落点 | 校准 |
|---|---|---|
| 外框 inset 12px + 左竖线 | 案头 `[data-desk-skin]` 纸框 + 左栏 | ✓ 已合 |
| 左栏 88px 纵排房间词 | 案头左栏（今日/日期/编排） | ✓ 已合 |
| `.modes` 行（上下线夹文字钮，当前=衬线斜体） | 编辑条/站点切换/分段控件 | 部分合，去掉残留药丸底 |
| `.strip` 四格条带 + 渐变 caption | 铺纸 SheetGrid | caption 字改 sans 11px |
| `.slips` 右栏纸条（左边线+下边线行） | 信夹/纸叠/画师墙标签行 | 标签去 mono |
| 92px 圆形日期章 rotate(-8deg) | 左栏书脊底部日期章 | **方→圆，36→92px** |
| `.sheet` 右缘抽屉（笺/印） | 队列笺/设置印（未来批） | — |
| tile 进场 clip-path 揭起 | 铺纸/画师墙进场 | **settle → clip-path** |
| 卡片 hover 变色 | 全站卡片 | **去抬升** |

## 6. 红线（继承项目铁律）

- 出厂红线：默认稿纸版式零「今日的纸/日期章」文案（e2e ⑥ 守护）。
- 任何分辨率与 DPI 自适应（满宽/密度升档/零留白）。
- Avoid unnecessary secondary labels and descriptions. Let the layout do the explaining.
- 色板归主题，语法归本规范——主题只换颜色不换结构。
