## [Unreleased]

暂无。

## [0.8.55] — 2026-09-08

对应 [PR #98](https://github.com/Atsukiizumi/Kami-paperbox/pull/98)。

### 新增

- Yande / Konachan / Danbooru 增加日榜、周榜、月榜；Danbooru 另有近期热门（order:rank）。
- 图站日周月榜会记进本机库，侧栏「热榜」可按站、按日期回看或清理。Pixiv 用浏览页日期直接拉原站历史榜，不再另存。
- 浏览历史保留 90 天、不设条数上限，可按站点筛选。
- FANBOX 投稿里的附件在详情页可下，入队会连文件一起收。

### 调整

- 拼画右上横排页数和 GIF，分辨率在右下。
- 浏览页榜单日期固定在右侧，加载时不再跳动。

## [0.8.54] — 2026-09-08

对应 [PR #97](https://github.com/Atsukiizumi/Kami-paperbox/pull/97)。

### 新增

- 图站标签数据库：按 general / copyright / character 等命名空间收录 Yande 系高频 tag，浏览时继续收词，设置里可补译。
- 设置改为左侧分类切页。

### 调整

- 搜图一次问 SauceNAO、ascii2d、IQDB，结果按引擎分组；被风控的那一组单独标明。
- 去掉 TinEye。SauceNAO API key 只在设置里填。

### 文档

- README 鸣谢 yande-re-chinese-patch、Yande.re、EhTagTranslation/Database、PixEz。

## [0.8.53] — 2026-09-08