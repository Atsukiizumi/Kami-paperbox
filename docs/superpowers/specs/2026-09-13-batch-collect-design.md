# 批量收藏（D）设计

日期：2026-09-13 · 状态：已实现（feat/batch-collect）
上游：新功能六方向 B→A→D→C→E→F 中的 D；B（#122）、A（#123）已落地
基线：main@634b63d

## 目标与非目标

**做**：pixiv 画师页与 fanbox 创作者页的「批量收藏」模式——进入选择模式后作品卡出现勾选框，底部浮动条全选/清除、入纸匣/下载；「加载至 200」循环翻页聚合；单次入队上限 200（超出禁用并提示）。

**不做**：跨页持久选择（选择态仅会话内）；booru 池整包入队（已有）；队列并发改造。

## 架构

- **选择态**：纯页面 useState（`Set<workKey>`），`ArtworkGrid`/`ArtworkCard` 新增可选 `selection` 属性渲染左上角勾选 chip（chip 内 stopPropagation，不触发卡片跳转）。
- **入队**：复用 `enqueueWorks(cards, "vault" | "download")`；全选/入队时过滤已在纸匣（vaultIndex）与已在队列的作品并提示数量。
- **上限**：`BATCH_MAX = 200`——选择超过时提示；「加载至 200」用 infinite query 的 fetchNextPage 循环（每次等上一页完成），到上限或无更多页停止。
- **移动端**：chips 触摸目标 ≥24px；浮动条贴底并避让底部导航（safe-area + md:偏移）。

## UI

- 画师页头部加「批量收藏」按钮（与追踪/关注并列）；进入后头部变为浮动操作条（已选计数、全选本页、清除、入纸匣、下载、完成）。
- pixiv 画师页数据源 = 现有 pixivUser 无限查询；fanbox 创作者页 = fanboxCreator 无限查询。已置顶（pickup）区同样可勾选。

## 错误处理

- 翻页失败：toast 提示并保留已加载部分可勾选。
- 队列重复：enqueue 前过滤 inQueue/inVault，结果 toast 明确「已入队 X 张（跳过已在纸匣 Y、队列中 Z）」。

## 测试

- 纯函数：`filterBatchable(cards, {inVault, inQueue})` 过滤与计数（node:test）。
- UI 走 Playwright 冒烟（选择模式渲染、勾选计数、浮动条出现）。
