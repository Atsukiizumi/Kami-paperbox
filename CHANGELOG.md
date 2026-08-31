# 更新日志

本文件记录 Kami 纸匣的用户可见变化，格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)。版本号大致遵循 [SemVer](https://semver.org/lang/zh-CN/)。

之后每次改动都会开 Pull Request，合并进 `main` 后再把条目写到这里。

## [Unreleased]

暂无。

## [0.5.0] — 2026-08-31

对应 [PR #11](https://github.com/Atsukiizumi/Kami-paperbox/pull/11)。

### 新增

- 设置里可以选下载目标文件夹（本机 Chrome / Edge）。收入纸匣仍先存在浏览器里，并可同时按规则写入该文件夹。
- 分类规则：扁平、作者、日期、日期+时间、作者+日期、站点+作者，或自己写 `{author}` `{date}` `{time}` `{title}` 等占位符。日期按保存当时计算。
- 浏览器会申请持久化存储，减少纸匣被自动清掉的机会。


## [0.4.3] — 2026-08-31

对应 [PR #10](https://github.com/Atsukiizumi/Kami-paperbox/pull/10)。

### 变更

- 浏览拼版改成流水排布：竖图填进最短的一列，横图仍跨列放大，不再在格子之间留下大块空白。


## [0.4.2] — 2026-08-31

对应 [PR #9](https://github.com/Atsukiizumi/Kami-paperbox/pull/9)。

### 变更

- 横图不再挤在单列里显得很小。普通横图会跨两列放大，特别宽的全景会铺满一整行。竖图仍按原比例拼在格子里。


## [0.4.1] — 2026-08-31

对应 [PR #8](https://github.com/Atsukiizumi/Kami-paperbox/pull/8)。

### 新增

- 换页、顶栏、侧栏和卡片会轻轻入场；导航指示条会滑过去。主题切换时配色会过渡。缩略图载入后淡入。加载骨架改成扫光。

## [0.4.0] — 2026-08-31

对应 [PR #7](https://github.com/Atsukiizumi/Kami-paperbox/pull/7)。

### 新增

- 设置和顶栏可以切换外观：浅色、深色，或跟随系统。
- 内置五套纸匣主题，每套都有深浅配色：和纸、青墨、朱砂、松烟、苔色。默认仍是和纸深色。

## [0.3.3] — 2026-08-31

对应 [PR #6](https://github.com/Atsukiizumi/Kami-paperbox/pull/6)。

### 变更

- 浏览、画师、创作者和相关作品改成按原图比例的拼版，不再统一裁成 3:4。特别横的或特别竖的会收在一个范围内。没有尺寸信息的卡片（多数 FANBOX）仍用 3:4。

## [0.3.2] — 2026-08-31

对应 [PR #5](https://github.com/Atsukiizumi/Kami-paperbox/pull/5)。

### 修复

- 开发模式下脚本会因为浏览器里 `new AsyncLocalStorage()` 直接崩掉，点任何按钮都没反应。不再把 `@tanstack/react-start` 预打包进前端。

## [0.3.1] — 2026-08-31

对应 [PR #4](https://github.com/Atsukiizumi/Kami-paperbox/pull/4)。

### 新增

- 浏览卡片、作品页、大图预览和纸匣都可以跳转源站「原始链接」。

### 修复

- 设置里保存代理以前只写到隐藏的 `.data/proxy.json`，打开 `kami.config.json` 会以为没存上。现在会同时写入 `kami.config.json`，立刻设置 `KAMI_PROXY`，Docker 数据卷会保留 `.data`。

### 变更

- `.gitignore` 忽略 `pnpm-lock.yaml` 和 `src/routeTree.gen.ts`（本地 `pnpm i` / `pnpm dev` 会再生成），并从版本库取消跟踪。

## [0.3.0] — 2026-08-31

### 新增

- 本更新日志，以及 README 入口。

### 变更

- 采用 [MIT License](LICENSE)。`package.json` 标注 `"license": "MIT"`。
- README 去掉法律声明和数据安全长文，只保留「本项目仅供学习交流」。

### 修复

- 点「浏览器登录 Pixiv / FANBOX」时，Vite `AbortError` 会把刚打开的 Chrome / Edge **立刻关掉**，看起来像没弹窗。登录窗口现在作为后台任务运行，和网页请求脱钩；设置页轮询状态，AbortError 不再整页刷新。
- 找不到窗口时看任务栏。设置里可以「取消弹窗」。终端成功时会打印 `[kami] 已打开登录窗口: …`。
- `puppeteer-core` 不再打进 Vite SSR 包，减少登录启动失败。

## [0.2.0] — 2026-08-31

对应 [PR #1](https://github.com/Atsukiizumi/Kami-paperbox/pull/1)、[PR #2](https://github.com/Atsukiizumi/Kami-paperbox/pull/2)。

### 新增

- 设置里「浏览器登录 Pixiv / FANBOX」：拉起本机 Chrome / Edge 打开官方登录页，抓取 `PHPSESSID` / `FANBOXSESSID`。手贴 Cookie 仍可用。Docker 无图形界面时请手贴。
- `/api/login-browser`、`/api/whoami`。
- Pixiv 与 FANBOX 用户名、头像分开保存，顶栏账号切换、图源切换、设置页都会显示。
- 依赖 `puppeteer-core`。找不到浏览器时可设 `KAMI_CHROME`。

## [0.1.0] — 2026-08-31

仓库首个公开快照。

### 新增

- 五个图源，顶栏一次只看一个站，每个站都能搜：Pixiv、pixiv FANBOX、Yande（yande.re）、Konachan、Danbooru。
- Pixiv 公开榜；登录后「为你推荐 / 关注」。FANBOX 公开创作者；登录后动态和已支持。图站最新 / 热门。
- 作品大图：缩放、拖动、键盘翻页。保存进纸匣、下载到磁盘。Pixiv 收藏（带 tag）、红心、关注；FANBOX 点赞、关注。动图播放并合成 GIF。
- 搜图：上传 / 拖入 / 粘贴本地图。默认 [SauceNAO](https://saucenao.com/)，可切 [IQDB](https://iqdb.org/)、[TinEye](https://tineye.com/)。
- 五个站都会带回 tag。
- 本地纸匣（IndexedDB）和下载队列。
- 多账号保存 Pixiv / FANBOX Cookie，顶栏切换。
- HTTP / SOCKS5 代理（设置、`kami.config.json`、`KAMI_PROXY`）。
- R-18 开关（默认关）。Pixiv AI 作画标记和过滤。
- Docker 与 `pnpm` 本地开发。监听地址写在 `kami.config.json`（默认 `0.0.0.0:8080`）。
- 可装成 PWA。
