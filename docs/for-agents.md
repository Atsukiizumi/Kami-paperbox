# 给后续智能体：Kami 纸匣怎么写

产品决策以用户原话为准。下面是已经定下来的写法，不要重新发明一套。

## 这是什么

本机图站浏览器：Pixiv / FANBOX / yande.re / Konachan / Danbooru。浏览、搜图、队列下载、纸匣归档。品牌是日本纸工房，不是仪表盘，也不是组件秀。

- 仓库：`Atsukiizumi/Kami-paperbox`
- 预览：`pnpm dev`，端口 `8080`
- 版本看 `CHANGELOG.md` 和 README 徽章

## 审美

- 墨黑书案 + 宣纸：`#0e0d0c` / `#171614` / `#f3efe8` / `#9c958c` / `#e8dfd2`
- 不要紫、金光、霓虹、emoji、把 UI 截图当品牌图
- 标题锁定 `Kami Paperbox` 或 `Kami 纸匣`
- 折角纸是记号。空态、Logo、加载哨兵用 `PaperMark`，空页用 `EmptySheet`
- 已在纸匣的浏览卡用 `.kami-card-folded`。「最新 / 置顶 / 原图被替换」用 `.kami-slip`
- 动效走 `src/lib/motion.ts`（FLIP / 进场）。不要给 left/top/width 做动画
- 新增动画必须进 `prefers-reduced-motion`
- 鼠标优先。不要先加全局快捷键或命令面板

## 排版

- 浏览 / 相关 / 历史作品：`MasonryBoard` + `packJustified`
- 纸匣：`.kami-vault-fall` 瀑布流竖列，封面保持原比例；交互仍是点进作品、悬停导出/移除
- 骨架也要走 `MasonryBoard`，不要均分 CSS grid
- 详情页一条吸顶：上一页 + 返回浏览 + 操作
- 悬停预览从封面长出，周围只淡一圈墨，不要整屏压暗

## 数据与通道

- 「下载」和「收入纸匣」必须 `enqueueWork`，可配 `flyPaperToQueue`
- 纸匣优先记用户文件夹路径 + SHA-256；应用内 vault 只是挂不上目录时的退路
- Booru tag 界面可中文、请求仍英文。Pixiv / FANBOX 不要套这套词表
- 搜索按空格拆多 tag（FANBOX 除外）
- Cookie 只走 `src/lib/browser-login.ts`。真实 Session 不准进仓库、测试、截图、changelog

## 代码习惯

- 文件头写清：作用、用法、为什么这样
- 用户看得见的变化写 `CHANGELOG.md`；用户说「不要 pr / 直接 commit」时听用户的
- 不要为了美化再引入一套商业组件库
- 站点逻辑在 `src/lib`，界面在 `src/components` 与 `src/routes`
- 品牌资产：`public/og.jpg`、`public/x-banner.jpg`、`public/favicon.svg`、`src/lib/og/site.json`

## 验证

```bash
npx tsc --noEmit
pnpm test
```
