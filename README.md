# Kami 纸匣

[![AI powered by Grok](https://img.shields.io/badge/AI-powered_by_Grok-0e0d0c?style=flat-square&labelColor=e8dfd2&logo=x&logoColor=0e0d0c)](https://grok.com)
[![xAI](https://img.shields.io/badge/built_with-Grok_Build-0e0d0c?style=flat-square&labelColor=e8dfd2)](https://x.ai)

个人向的插画备份工具。在浏览器里浏览、预览、排队下载，把已经有权查看的作品收到本机纸匣。

支持 **Pixiv**、**pixiv FANBOX**、**Yande**（yande.re）、**Konachan**、**Danbooru**。可安装成桌面应用（PWA），也可用 Docker 或 Node 自行部署。

> 请尊重作者版权。不要转载、商用或二次分发。只保存你已经有权查看的内容。

---

## 功能一览

| | |
| --- | --- |
| 浏览 | 顶栏切换图源，一次只看一个站。每个图源都有搜索。Pixiv 公开榜；登录后「为你推荐 / 关注」。FANBOX 公开创作者；登录后动态与已支持。图站最新 / 热门。 |
| 作品 | 大图预览（缩放、拖动、键盘翻页）。底部操作条：保存、下载。Pixiv 还可收藏（带 tag）、红心、关注。动图在线播放，可合成 GIF。 |
| 搜图 | 上传、拖入或粘贴本地图。默认 [SauceNAO](https://saucenao.com/)，可切 [IQDB](https://iqdb.org/)、[TinEye](https://tineye.com/)。作品页有「搜来源」。 |
| 标签 | 五个站都会拉取 tag。卡片显示前几个，作品页可点回当前站搜索。 |
| 纸匣 / 队列 | IndexedDB 本地归档；批量加入队列。原图或较小尺寸可选。 |
| 账号 | 多份 Pixiv / FANBOX Cookie 存在本机，顶栏切换。图站不用登录。 |
| 代理 | 设置里填写 http / socks5 地址，Pixiv、图站、搜图都走它。也可写进 `kami.config.json` 或 `KAMI_PROXY`。 |
| 过滤 | R-18 默认关。Pixiv AI 作画打 **AI** 标签，可一键过滤。涉及未成年人的标签始终丢掉。 |

导航：**浏览 / 搜图 / 队列 / 纸匣 / 设置**。

---

## 使用

### 浏览

1. 顶栏下拉切换当前图源（一次只看一个站）。
2. 搜索框输入该站标签，或粘贴源站链接（作品、用户、`?tags=` 列表都行）。
3. 点卡片进作品页。点开大图后底部有保存 / 下载；Pixiv / FANBOX 另有社交按钮（需登录）。
4. 作品页的标签可点，会回到当前站点搜这个标签。

| 图源 | 未登录 | 登录后 | 搜索 |
| --- | --- | --- | --- |
| Pixiv | 日 / 周 / 月榜等 | 为你推荐、关注、R-18 榜 | 标签、作品链接、画师链接 |
| FANBOX | 公开创作者（默认 `official`） | 动态、已支持 | 标签、创作者 ID / 链接 |
| Yande / Konachan / Danbooru | 最新、热门 | 不需要登录 | 标签、作品链接 |

### 搜图

1. 打开「搜图」，默认 SauceNAO，也可切 IQDB 或 TinEye。
2. 选择、拖入或 Ctrl+V 粘贴一张本地图片（不超过 8 MB）。
3. 结果若属于本工具已支持的站点，会直接打开作品页；其它来源跳原站。

作品页的「搜来源」会拿当前预览图去查。SauceNAO 匿名有次数限制，用满了可换另外两个站。

### 大图操作条

点开预览后，底部按钮行为靠近 [Pixiv 工具箱 Next](https://github.com/leoding86/webextension-pixiv-toolkit)：

| 按钮 | Pixiv（需登录） | FANBOX（需登录） | 图站 |
| --- | --- | --- | --- |
| 保存 | 收入纸匣 | 收入纸匣 | 收入纸匣 |
| 下载 | 下到磁盘（动图合成 GIF） | 下到磁盘 | 下到磁盘 |
| 收藏 | 公开收藏，并带上作品标签 | — | — |
| 红心 | Pixiv「喜欢」 | 投稿点赞 | — |
| 关注 | 该画师；画师页同样有 | 该创作者 | — |

未登录点社交按钮会提示去设置填 Cookie。图站没有账号体系，大图里只提供保存和下载。

### R-18

浏览页右上角和设置里都有开关，**默认关闭**。

| 站点 | 关闭时 | 打开后 |
| --- | --- | --- |
| Pixiv | 全年龄榜与搜索 | 显示 R-18 榜（需登录） |
| Yande / Konachan | `rating:s` | 含成人向，卡片打 R-18 标记 |
| Danbooru | `rating:g` | 含敏感 / 成人向 |

无论开关如何，带有 loli、shota、toddlercon 等标签的作品都会被丢掉，不会进列表或纸匣。

### AI 作画（Pixiv）

官方标了 AI 生成（`aiType = 2`）或带有「AI生成」一类标签的作品，卡片和作品页会显示 **AI**。

浏览页和设置里的「过滤 AI」打开后，这些作品不会出现在榜单、搜索、推荐、关注和画师页。已经打开的作品页不受影响。

### 账号（仅 Pixiv / FANBOX）

Cookie 只写在这台设备的浏览器存储里，不会进服务器数据库。

1. 用电脑浏览器登录 [pixiv.net](https://www.pixiv.net) 或 [fanbox.cc](https://www.fanbox.cc)
2. 打开开发者工具 → Application / 存储 → Cookies
3. 复制 `PHPSESSID`（Pixiv）或 `FANBOXSESSID`（FANBOX）的值
4. 在设置里新建或选中账号，粘贴后保存

顶栏账号菜单可切换。公开榜单、图站和免费投稿不填也能用。

### 代理

访问 Pixiv 等站点不通时，在设置里填代理即可，**保存后立即生效**（不用重启）。

```
127.0.0.1:7890
http://127.0.0.1:7890
socks5://127.0.0.1:1080
http://user:pass@127.0.0.1:7890
```

点「检测连通」会用这个地址访问 Pixiv。也可以不走界面：

- [kami.config.example.json](kami.config.example.json) 复制为 `kami.config.json` 后填写 `"proxy"`
- 环境变量 `KAMI_PROXY`（其次 `ALL_PROXY` / `HTTPS_PROXY` / `HTTP_PROXY`）

设置里保存的地址优先。Docker 访问宿主机 Clash 可用 `KAMI_PROXY=http://host.docker.internal:7890`。

### 纸匣与队列

- **保存**：原图（或动图合成的 GIF）存进本机 IndexedDB
- **下载**：同时触发浏览器下载
- **加入队列**：批量处理，在「队列」页看进度
- 设置里「保存原图 / 高清 GIF」关闭后改用较小尺寸，更快

纸匣数据跟着浏览器走。清站点数据或换浏览器会丢失，重要文件请再导出一份到磁盘。

---

## 支持的链接

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

## 部署

需要 **Node.js 22** 和本机的 `curl`（Danbooru 走 curl 拉取）。

本地最快：

```bash
pnpm i
pnpm dev
```

### Docker（推荐给服务器）

```bash
docker compose up --build
```

服务映射到本机 **8080**。停止：`docker compose down`。

单独构建镜像：

```bash
docker build -t kami-paperbox .
docker run --rm -p 8080:8080 kami-paperbox
```

镜像是多阶段生产构建：构建阶段用 Nitro `node` 预设打出 `.output`，运行阶段只保留 Node 22 + curl。

### 从源码运行（生产）

```bash
pnpm i
NITRO_PRESET=node pnpm build
HOST=0.0.0.0 PORT=8080 pnpm start
```

默认的 `pnpm build`（不设 `NITRO_PRESET`）产出 Vercel 目录 `.vercel/output`，给平台部署用。Docker 和自托管请带上 `NITRO_PRESET=node`。

---

## 开发

需要 **Node.js 22+**。推荐 [pnpm](https://pnpm.io/)：

```bash
pnpm i
cp kami.config.example.json kami.config.json   # 首次；已有本地配置会跳过
pnpm dev
```

`kami.config.json` 和 `.env` **不要提交**。仓库里只有样板：

| 样板 | 本地复制为 | 用途 |
| --- | --- | --- |
| `kami.config.example.json` | `kami.config.json` | 监听地址、代理 |
| `.env.example` | `.env` | 可选环境变量 |

第一次 `pnpm dev` 若还没有 `kami.config.json`，会自动从样板复制一份。代理、Cookie 只留在本机。

浏览器打开 http://localhost:8080 。要改端口只改 `kami.config.json`：

```json
{ "host": "0.0.0.0", "port": 8080 }
```

缺依赖时会提示先 `pnpm install`。Windows 下路径带空格也可以直接 `pnpm dev`。

没有 pnpm 时：

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
| `pnpm pack` | 打包源码为 `kami-paperbox.tar.gz`（排除 `node_modules`） |

指定输出路径：

```bash
python3 scripts/pack.py -o kami-paperbox.tar.gz
```

### 目录

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
src/lib/vault.ts                本机纸匣（IndexedDB）
src/lib/ugoira.ts               动图播放与 GIF 合成
src/lib/store.ts                设置、账号、队列
scripts/pack.py                 源码打包
kami.config.example.json    监听地址 / 代理样板（复制为 kami.config.json）
.env.example                环境变量样板
.gitignore                  排除本机配置、依赖、构建产物
Dockerfile                      生产镜像
docker-compose.yml              一键启动
```

源站请求都走服务端代理（Referer、Cookie、媒体转发）。浏览器不直连 Pixiv 图片 CDN。会话 Cookie 经服务端短期使用，持久化仍在用户本机。

---

## 技术栈

React 19、TanStack Router / Query / Start、Vite、Nitro、Tailwind CSS 4、Zustand、IndexedDB、fflate + gifenc。

---

## 隐私与边界

- 账号 Cookie 只存在当前浏览器，换设备不会同步
- 图站内容按各站公开 API 拉取；Pixiv / FANBOX 的收藏、R-18、付费档需要你自己的会话
- 不会绕过 FANBOX 订阅墙：没订的投稿打不开附件
- 过滤未成年人相关标签、AI 标记是产品规则，不是源站审核的替代
- 本工具是个人备份，不是爬虫农场或公开图床

Kami Paperbox / Kami 纸匣。

AI powered by [Grok](https://grok.com) · built with [Grok Build](https://x.ai) (xAI).
