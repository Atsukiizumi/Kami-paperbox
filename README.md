# Kami 纸匣 📦✨

[![AI powered by Grok](https://img.shields.io/badge/AI-powered_by_Grok-0e0d0c?style=flat-square&labelColor=e8dfd2&logo=x&logoColor=0e0d0c)](https://grok.com)
[![xAI](https://img.shields.io/badge/built_with-Grok_Build-0e0d0c?style=flat-square&labelColor=e8dfd2)](https://x.ai)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=flat-square)](LICENSE)
[![Changelog](https://img.shields.io/badge/changelog-0.7.6-e8dfd2?style=flat-square&labelColor=0e0d0c)](CHANGELOG.md)

ねえねえ、这边这边〜🌸

Kami 纸匣是给自己用的插画小抽屉。喜欢的图就轻轻放进来，浏览、放大、排队下载，全部留在你这台电脑上，哪里都不同步的那种安心感 💕

Pixiv、pixiv FANBOX、Yande（yande.re）、Konachan、Danbooru 都请到同一间屋子里了。浏览器打开就能用，还能装成桌面应用（PWA）。想认真部署的话，Docker 或 Node 都可以よ。

**本项目仅供学习交流。**

---

## 都会什么呀 ✨

| | |
| --- | --- |
| 浏览 | 顶栏切换图源，一次只看一个站（专心！）。卡片上可直接保存进纸匣；Pixiv 还能点红心。 |
| 作品 | 大图可以缩放、拖动、键盘翻页。标题下展示标签，点一下就按当前站点搜索。底下有保存、下载。Pixiv 还能收藏（带着 tag）、红心、关注。 |
| 搜图 | 上传、拖进去、或者粘贴一张本地图。默认 [SauceNAO](https://saucenao.com/)，也可以换成 [IQDB](https://iqdb.org/)、[TinEye](https://tineye.com/)。作品页有「搜来源」，超方便。 |
| 标签 | 五个站都会把 tag 带回来。作品页点标签按该站规则搜索（Pixiv 精确匹配，图站空格=并且、空格写成下划线）。星星可保存成各站自己的快捷标签，浏览页一点就能搜。 |
| 纸匣 / 队列 | 本机 Node 目录（`.data/vault`：SQLite + 原图），浏览器 IndexedDB 作预览。设置里可选再拷一份到文件夹。想批量就丢进队列。 |
| 账号 | Pixiv / FANBOX 的 Cookie 可以存好几份，顶栏切换。图站不用登录，轻松。 |
| 代理 | 设置里填 http / socks5，Pixiv、图站、搜图都会乖乖走它。也可以写进 `kami.config.json` 或 `KAMI_PROXY`。 |
| 过滤 | R-18 默认关闭。Pixiv AI 作画会打 **AI** 标签，可一键过滤。 |
| 外观 | 顶栏或设置里切换浅色 / 深色 / 跟随系统，并内置和纸、青墨、朱砂、松烟、苔色五套主题。 |
| 动效 | 换页淡入、卡片错落出现、导航指示条滑动、主题配色过渡。系统若开了减少动态，会自动收住。 |

导航就这几页：**浏览 / 搜图 / 队列 / 纸匣 / 设置**。迷路不了啦。

---

## 怎么玩 🎮

### 浏览

1. 顶栏下拉，换当前图源。一次只交一个朋友，专心看。
2. 搜索框丢标签，或者直接粘贴源站链接（作品、用户、`?tags=` 列表都行）。
3. 卡片封面右下角：保存进纸匣；Pixiv 还可以点红心（要登录）。点卡片本身进作品页。
4. 作品页的标签可以点，会回到当前站点搜这个词。便利すぎ。

| 图源 | 未登录 | 登录后 | 搜索 |
| --- | --- | --- | --- |
| Pixiv | 日 / 周 / 月榜等 | 为你推荐、关注、R-18 榜 | 标签、作品链接、画师链接 |
| FANBOX | 公开创作者（默认 `official`） | 动态、已支持 | 标签、创作者 ID / 链接 |
| Yande / Konachan / Danbooru | 最新、热门 | 不需要登录 | 标签、作品链接 |

### 搜图 🔍

1. 打开「搜图」，默认 SauceNAO。IQDB、TinEye 随你切。
2. 选文件、拖进来，或者 Ctrl+V 粘贴一张本地图（不超过 8 MB ね）。
3. 如果是本工具认识的站点，会直接打开作品页；其他来源就跳回原站。

作品页的「搜来源」会拿当前预览图去查。SauceNAO 匿名有次数限制，用完了换另外两个站就好，不必慌。

### 大图操作条

点开预览以后，底部按钮的感觉靠近 [Pixiv 工具箱 Next](https://github.com/leoding86/webextension-pixiv-toolkit)：

| 按钮 | Pixiv（需登录） | FANBOX（需登录） | 图站 |
| --- | --- | --- | --- |
| 保存 | 收入纸匣 | 收入纸匣 | 收入纸匣 |
| 下载 | 下到磁盘（动图合成 GIF） | 下到磁盘 | 下到磁盘 |
| 收藏 | 公开收藏，并带上作品标签 | — | — |
| 红心 | Pixiv「喜欢」 | 投稿点赞 | — |
| 关注 | 该画师；画师页同样有 | 该创作者 | — |
| 原始链接 | 打开源站作品页 | 打开源站投稿 | 打开源站作品页 |

没登录就去点社交按钮的话，会提醒你先去设置填 Cookie。图站没有账号体系，大图里只给保存和下载，简洁可爱。

### R-18

浏览页右上角和设置中均有开关，**默认关闭**。

| 站点 | 关闭时 | 打开后 |
| --- | --- | --- |
| Pixiv | 全年龄榜与搜索 | 显示 R-18 榜（需登录） |
| Yande / Konachan | `rating:s` | 含成人向，卡片打 R-18 标记 |
| Danbooru | `rating:g` | 含敏感 / 成人向 |

### AI 作画（Pixiv）

官方标了 AI 生成（`aiType = 2`），或带着「AI生成」一类标签的作品，卡片和作品页会亮一个 **AI**。

浏览页和设置里的「过滤 AI」打开后，这些作品不会出现在榜单、搜索、推荐、关注和画师页。已经打开的作品页不受影响，别担心点进去会突然消失。

### 账号（仅 Pixiv / FANBOX）

设置里的「登录 Pixiv / FANBOX」会由后端打开 **官方登录页**，把画面中转到纸匣窗口里。FANBOX 会先到 Pixiv 选账号，再回转 `www.fanbox.cc/auth/start` 把会话带回来。密码只打在官方站点上。访客 Cookie 不算。网页预览和 Docker 也能这样登录。不想走窗口的话，可以手贴 Cookie。

手贴步骤：

1. 在浏览器登录 [pixiv.net](https://www.pixiv.net) 或 [fanbox.cc](https://www.fanbox.cc)
2. 打开开发者工具 → Application / 存储 → Cookies
3. 复制 `PHPSESSID`（Pixiv）或 `FANBOXSESSID`（FANBOX）的值。Pixiv 已登录的值形如 `12345678_后面一串`。Cookie-Editor JSON、Netscape cookies.txt 或整段 Cookie 头也可以直接粘。
4. 在设置里新建或选中账号，粘贴后保存

公开榜单、图站和免费投稿不填凭证也可以用。找不到浏览器时，可设置环境变量 `KAMI_CHROME` 指向 `chrome.exe` / `msedge.exe`。如果配置了代理，登录中转也会走同一代理。

### 代理

源站不可达时，可在设置中填写代理，点「保存代理」会写入本机 `kami.config.json`（以及 `.data/proxy.json`），对后续上游请求立即生效。重启以后也还在。

```
127.0.0.1:7890
http://127.0.0.1:7890
socks5://127.0.0.1:1080
http://user:pass@127.0.0.1:7890
```

「检测连通」会使用该地址请求 Pixiv。也可不经界面配置：

- 将 [kami.config.example.json](kami.config.example.json) 复制为 `kami.config.json` 后填写 `"proxy"`
- 环境变量 `KAMI_PROXY`（其次 `ALL_PROXY` / `HTTPS_PROXY` / `HTTP_PROXY`）

设置中保存的地址优先。Docker 访问宿主机代理示例：`KAMI_PROXY=http://host.docker.internal:7890`。

### 纸匣与队列 🗂️

- **保存**：原图（或动图合成的 GIF）写入本机 Node 目录（`.data/vault`），浏览器里留一份预览。纸匣页可按标题、作者、标签、路径搜索。
- **目录**：`pnpm dev` / `pnpm start` 就是这台 Node 服务器。元数据是 SQLite（`.data/vault/vault.sqlite`），文件在 `.data/vault/files`。不是图数据库，作者/标签只是关系表上的字段。Docker 已经把 `.data` 做成数据卷。Vercel 不能写磁盘，会自动只用浏览器缓存。细节见 [docs/storage.md](docs/storage.md)。
- **目标文件夹**：设置里用 Chrome / Edge 选一个本机文件夹，保存和下载可按规则再写一份到磁盘
- **分类规则**：扁平、作者、日期、日期+时间、作者+日期、站点+作者，或自己写 `{author}` `{date}` `{title}` 等占位符
- **下载**：有目标文件夹则按规则写入；否则走浏览器下载（路径里的斜杠会收成下划线）
- **加入队列**：批量处理，去「队列」页看进度
- 设置里把「保存原图 / 高清 GIF」关掉，就会用较小尺寸，更快一点

---

## 能读懂的链接 🔗

| 类型 | 例子 |
| --- | --- |
| Pixiv 作品 | `https://www.pixiv.net/artworks/123` |
| Pixiv 用户 | `https://www.pixiv.net/users/123` |
| Pixiv 标签 | `https://www.pixiv.net/tags/风景` |
| FANBOX 投稿 | `https://name.fanbox.cc/posts/123` |
| FANBOX 创作者 | `https://name.fanbox.cc` |
| Yande | `https://yande.re/post/show/123`、`https://yande.re/post?tags=landscape` |
| Konachan | `https://konachan.com/post/show/123` |
| Danbooru | `https://danbooru.donmai.us/posts/123` |

---

## 部署 🚀

需要 **Node.js 22**，以及本机的 `curl`（Danbooru 走 curl 去请）。

本地最快的打开方式：

```bash
pnpm i
pnpm dev
```

### Docker（给服务器用，推荐）

```bash
docker compose up --build
```

会映射到本机 **8080**。停下来就 `docker compose down`。

单独构建镜像：

```bash
docker build -t kami-paperbox .
docker run --rm -p 8080:8080 kami-paperbox
```

镜像是多阶段生产构建：构建阶段用 Nitro `node` 预设打出 `.output`，运行阶段只留下 Node 22 + curl。瘦瘦的，可爱。

### 从源码跑生产环境

```bash
pnpm i
NITRO_PRESET=node pnpm build
HOST=0.0.0.0 PORT=8080 pnpm start
```

默认的 `pnpm build`（不设 `NITRO_PRESET`）会产出 Vercel 目录 `.vercel/output`，给平台部署用。Docker 和自托管请记得带上 `NITRO_PRESET=node` 哦。

---

## 开发 💻

需要 **Node.js 22+**。推荐 [pnpm](https://pnpm.io/)：

```bash
pnpm i
cp kami.config.example.json kami.config.json   # 第一次；已经有本地配置就会跳过
pnpm dev
```

`kami.config.json` 和 `.env` 不要提交到 git。仓库只提供不含秘密的样板：

| 样板 | 本地复制为 | 用途 |
| --- | --- | --- |
| `kami.config.example.json` | `kami.config.json` | 监听地址、代理 |
| `.env.example` | `.env` | 可选环境变量 |

第一次 `pnpm dev` 如果还没有 `kami.config.json`，会自动从样板复制一份。

然后打开 http://localhost:8080 。想改端口的话，只动 `kami.config.json`：

```json
{ "host": "0.0.0.0", "port": 8080 }
```

缺依赖时会提醒你先 `pnpm install`。Windows 路径里有空格也没关系，直接 `pnpm dev` 就好。

还没有 pnpm 的话：

```bash
npm i -g pnpm
# 或
corepack enable
```

| 命令 | 作用 |
| --- | --- |
| `pnpm i` | 安装依赖 |
| `pnpm dev` | 开发服务器（http://localhost:8080） |
| `pnpm build` | 生产构建（默认 Vercel） |
| `NITRO_PRESET=node pnpm build` | 自托管 / Docker 用的 Node 构建 |
| `pnpm start` | 启动 `.output/server` |
| `pnpm test` | 单元测试 |
| `pnpm typecheck` | TypeScript 检查 |
| `pnpm pack` | 打包源码为 `kami-paperbox.tar.gz`（排除 `node_modules`、`.git`、本机秘密） |

指定输出路径：

```bash
python3 scripts/pack.py -o kami-paperbox.tar.gz
```

### 上游站点怎么读

Pixiv / FANBOX 没有给第三方的公开 API。纸匣对着官方页面把网站自己的 XHR 记下来再复打。

- 逐步实操（DevTools、无头拦包、拆 JS、curl、Cookie）：[docs/reverse-engineering.md](docs/reverse-engineering.md)
- 已经在用的接口清单和代码落点：[docs/upstream.md](docs/upstream.md)
- 纸匣怎么存（SQLite + 原图文件，为什么不是图数据库）：[docs/storage.md](docs/storage.md)
- 注释约定（作用 / 用法 / 为什么）：[docs/comments.md](docs/comments.md)

无头环境拦 XHR：

```bash
node scripts/sniff-xhr.mjs "https://www.pixiv.net/ranking.php?mode=daily&content=illust"
```

### 屋子里都有谁

```
src/routes/                     浏览、搜图、作品、队列、纸匣、设置
src/routes/api/media.ts         图片代理
src/routes/api/reverse-search.ts 搜图上传
src/components/site-switcher.tsx 顶栏图源切换
src/components/work-actions.tsx 保存 / 下载 / 收藏 / 红心 / 关注
src/lib/upstream.server.ts      源站代理（Pixiv / FANBOX / 图站）
src/lib/social.ts               Pixiv 收藏 / 红心解析
src/lib/social.server.ts        Pixiv / FANBOX 社交操作
src/lib/reverse-search.ts       SauceNAO / IQDB / TinEye
src/lib/booru.ts                Yande / Konachan / Danbooru
src/lib/pixiv-feed.ts           榜单、推荐、AI 标记
src/lib/site-tags.ts            各站标签规则与快捷标签
src/lib/vault.ts                浏览器纸匣缓存（IndexedDB）
src/lib/vault-query.ts          按标题/作者/标签/路径过滤
src/lib/vault-store.server.ts   本机 Node 目录（SQLite + 文件）
src/lib/vault-sync.ts           浏览器推送到 /api/vault
src/routes/api/vault.ts         纸匣 HTTP
src/lib/download-path.ts        下载分类规则
src/lib/folder-access.ts        本机目标文件夹
src/lib/persist-files.ts        纸匣 + 文件夹双写
src/lib/ugoira.ts               动图播放与 GIF 合成
src/lib/store.ts                设置、账号、队列
scripts/pack.py                 源码打包
kami.config.example.json        监听地址 / 代理样板（复制为 kami.config.json）
.env.example                    环境变量样板
.gitignore                      排除本机配置、依赖、构建产物
CHANGELOG.md                    更新日志
docs/storage.md                 纸匣怎么存（SQLite + 文件，不是图库）
Dockerfile                      生产镜像
docker-compose.yml              一键启动
```

---

## 技术栈 🛠️

React 19、TanStack Router / Query / Start、Vite、Nitro、Tailwind CSS 4、Zustand、IndexedDB、fflate + gifenc。

一屋子优等生。

---

## 许可证 📜

采用 [MIT License](LICENSE)。本项目仅供学习交流。更新记录见 [CHANGELOG.md](CHANGELOG.md)。

Kami Paperbox / Kami 纸匣。今天也要好好收纳喜欢的画呀 📦🌸

AI powered by [Grok](https://grok.com) · built with [Grok Build](https://x.ai) (xAI).
