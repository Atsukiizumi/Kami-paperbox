# 案头铺纸重塑方案 · 一页纸（BINDERY 风格批一）

> 对象：主页「案头」（`/`，`src/routes/desk.tsx` + `src/components/desk/*`）
> 前置：BINDERY 设计定稿（`pitch-d-bindery-design.md`）；风格基准 = `/bindery` 演示间（已合并 main）
> 节奏：本页方案先拍板，再动工。分支 `feat/desk-bindery-restyle`。

---

## 两条原则

1. **语法进案头，颜色跟主题。** 这次带来的是「线分纸 / mono 计数 / 朱红 / 套印错位 / 印章」这套**语法**；一切色值走现有 `--color-*` token——四主题 × 明暗自动适配，主题包（everything can design）承诺毫发无伤。日间默认主题自然显形「和纸白纸面」，夜间就是墨黑纸 + 朱印，同样成立。
2. **功能零改动红线。** 槽模型、版式架数据、键盘编排、托盘、双内置版式（稿纸/编辑式）结构、desk-layout e2e 四条——全部不动。动的只有观感。

**实现口径**：DeskPage 根元素挂 `data-desk-skin="bindery"`，全部新样式写在该属性选择器下（与 `data-kami-style="hand"` 同套路，先例在册）；后续外壳批/组件批复用同一入口。

## 逐项改造（现状 → 变成）

| # | 元素 | 现状 | BINDERY 化 |
|---|---|---|---|
| 1 | 案头页面容器 | 无框内容流 | **一张纸**：外缘 1px 细线纸框（`color-mix(fg 12%)`），桌面端页内左缘一条竖分栏线 |
| 2 | 模块槽（铺纸/报纸/信/纸叠/画师墙） | 各自 surface 卡 + 阴影 | **线分纸**：去底色去阴影，模块间 1px 线分割；模块标题行统一 `kami-sheet-label`（11px mono 大写字距 + 右缘计数，如 信夹 03 / 纸叠 2） |
| 3 | 铺纸 tile（browse-sheet 卡片） | `kami-card-shell` 圆角 + 阴影 + 3px 悬浮 | **図版卡**：直角、无阴影；hover **套印错位**——位移 -2px,-2px + 双向硬阴影（`danger` 朱影 + `muted` 青影，token 派生） |
| 4 | tile 说明条 | caption 渐变 | 渐变保留，字改 mono 10px 档案体（図号 · 来源 · 尺寸） |
| 5 | tile 首批进场 | crossfade | **铺开**：`clip-path` 自下而上 0.95s 逐格 stagger；轮播 crossfade 照旧；`data-motion=off` 直出 |
| 6 | 信 / 纸叠行 | 已是行式 slip | 统一 mono 行 + 右侧 muted 计数，与 sheet-label 同语言 |
| 7 | 编排（编辑）模式 | 中性编辑卡 | **朱红 dashed 轮廓**、选中实线；退出编排盖「整理済」小章（500ms 弹入，motion off 直出） |
| 8 | 案头页脚 | 无 | 一行 mono 元数据：日期（中文数字）· 四源就绪态 · 纸匣 n 点——与 `/bindery` 演示间同款收尾 |

## 明确不做（写进 PR 红线）

- 不改默认版式的模块组成与结构（观感统一变化会记 CHANGELOG 说明）
- **不碰全局 `kami-card-shell`**——本批只作用于案头；浏览/纸匣/队列的図版化留给组件批
- 不新增字体、图标、依赖

## 验收口径

- 四象验收图：稿纸 / 编辑式 × 明 / 暗，逐张过目（沿用案头验收图惯例）
- `desk-layout` e2e 四条保持绿；`pnpm test` 全绿；typecheck / lint / build
- 390 宽无横向溢出；`data-motion=off` 下全部动效直出
- PR 附前后对比图

## 与后续批的衔接

- **批二（外壳/主题）**：BINDERY 落为内置主题 + 外壳细线纸面 chrome；设置页给 `/bindery` 演示间加入口也挂批二。
- **批三（组件）**：浏览/纸匣/队列卡片统一図版语言（套印 hover、mono caption），铺到全站。
