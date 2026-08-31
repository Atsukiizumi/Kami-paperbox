# Kami 纸匣 📦✨

[![AI powered by Grok](https://img.shields.io/badge/AI-powered_by_Grok-0e0d0c?style=flat-square&labelColor=e8dfd2&logo=x&logoColor=0e0d0c)](https://grok.com)
[![xAI](https://img.shields.io/badge/built_with-Grok_Build-0e0d0c?style=flat-square&labelColor=e8dfd2)](https://x.ai)

ねえねえ、这边这边〜🌸

Kami 纸匣是给自己用的插画小抽屉。喜欢的图就轻轻放进来，浏览、放大、排队下载，全部留在你这台电脑上，哪里都不同步的那种安心感 💕

Pixiv、pixiv FANBOX、Yande（yande.re）、Konachan、Danbooru 都请到同一间屋子里了。浏览器打开就能用，还能装成桌面应用（PWA）。想认真部署的话，Docker 或 Node 都可以よ。

**法律、版权、数据安全相关内容见文末「法律声明」「数据安全」。该部分必须用严肃条款阅读，与上文介绍语气不同。**

---

## 都会什么呀 ✨

| | |
| --- | --- |
| 浏览 | 顶栏切换图源，一次只看一个站（专心！）。每个图源都能搜。Pixiv 公开榜；登录后还有「为你推荐 / 关注」。FANBOX 公开创作者；登录后看动态和已支持。图站则是最新 / 热门。 |
| 作品 | 大图可以缩放、拖动、键盘翻页。底下有保存、下载。Pixiv 还能收藏（带着 tag）、红心、关注。动图会动，还能合成 GIF よ〜 |
| 搜图 | 上传、拖进去、或者粘贴一张本地图。默认 [SauceNAO](https://saucenao.com/)，也可以换成 [IQDB](https://iqdb.org/)、[TinEye](https://tineye.com/)。作品页有「搜来源」，超方便。 |
| 标签 | 五个站都会把 tag 带回来。卡片上先露几个，作品页点一下就能回当前站搜索。 |
| 纸匣 / 队列 | IndexedDB 本地归档，想批量就丢进队列。原图或小图自己选。 |
| 账号 | Pixiv / FANBOX 的 Cookie 可以存好几份，顶栏切换。图站不用登录，轻松。 |
| 代理 | 设置里填 http / socks5，Pixiv、图站、搜图都会乖乖走它。也可以写进 `kami.config.json` 或 `KAMI_PROXY`。 |
| 过滤 | R-18 默认关闭。Pixiv AI 作画会打 **AI** 标签，可一键过滤。涉及未成年人的标签由客户端尽力拦截，详见法律声明。 |

导航就这几页：**浏览 / 搜图 / 队列 / 纸匣 / 设置**。迷路不了啦。

---

## 怎么玩 🎮

### 浏览

1. 顶栏下拉，换当前图源。一次只交一个朋友，专心看。
2. 搜索框丢标签，或者直接粘贴源站链接（作品、用户、`?tags=` 列表都行）。
3. 点卡片进作品页。大图底下有保存 / 下载；Pixiv / FANBOX 还有社交按钮（要登录哦）。
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

没登录就去点社交按钮的话，会提醒你先去设置填 Cookie。图站没有账号体系，大图里只给保存和下载，简洁可爱。

### R-18

浏览页右上角和设置中均有开关，**默认关闭**。

| 站点 | 关闭时 | 打开后 |
| --- | --- | --- |
| Pixiv | 全年龄榜与搜索 | 显示 R-18 榜（需登录） |
| Yande / Konachan | `rating:s` | 含成人向，卡片打 R-18 标记 |
| Danbooru | `rating:g` | 含敏感 / 成人向 |

打开此开关即表示使用者自行确认已成年，并自行承担所在司法管辖区关于成人内容的全部合规责任。作者、贡献者不审核、不担保、不代为承担该责任。

无论开关状态如何，客户端会尽力丢弃带有 loli、shota、toddlercon 等标签的作品，使其不进入列表或纸匣。该规则为产品侧尽力拦截，**不是**对任何法律法规的合规保证，也**不能**替代源站审核或使用者的法定义务。详见文末法律声明。

### AI 作画（Pixiv）

官方标了 AI 生成（`aiType = 2`），或带着「AI生成」一类标签的作品，卡片和作品页会亮一个 **AI**。

浏览页和设置里的「过滤 AI」打开后，这些作品不会出现在榜单、搜索、推荐、关注和画师页。已经打开的作品页不受影响，别担心点进去会突然消失。

### 账号（仅 Pixiv / FANBOX）

会话凭证（Cookie）仅写入**当前设备上的当前浏览器存储**，不进入本软件的服务器数据库。这不构成对凭证安全的保证。

1. 使用本人有权使用的浏览器账号登录 [pixiv.net](https://www.pixiv.net) 或 [fanbox.cc](https://www.fanbox.cc)
2. 打开开发者工具 → Application / 存储 → Cookies
3. 复制 `PHPSESSID`（Pixiv）或 `FANBOXSESSID`（FANBOX）的值
4. 在设置里新建或选中账号，粘贴后保存

凭证等同于登录态。泄露、出借、提交到 git、发到聊天软件，均可能导致账号被盗。使用者自行保管，作者无法收回、无法冻结、亦不承担责任。公开榜单、图站和免费投稿不填凭证也可使用。

### 代理

源站不可达时，可在设置中填写代理，保存后立即对后续上游请求生效。

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

代理由使用者自行指定并自行运营或向第三方购买。本项目作者不提供、不中转、不审计任何代理流量。经代理传输的 Cookie、图片与查询内容，其保密性取决于该代理。含用户名口令的代理 URL 不得提交到版本库。

### 纸匣与队列 🗂️

- **保存**：原图（或动图合成的 GIF）存进本机 IndexedDB
- **下载**：同时触发浏览器下载
- **加入队列**：批量处理，去「队列」页看进度
- 设置里把「保存原图 / 高清 GIF」关掉，就会用较小尺寸，更快一点

纸匣数据仅存在当前浏览器的 IndexedDB。清除站点数据、更换浏览器或损坏磁盘都会导致丢失。作者不提供云备份，不对数据灭失负责。重要文件须由使用者自行导出到受控存储。

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

`kami.config.json` 和 `.env` **禁止提交到 git**。仓库只提供不含秘密的样板：

| 样板 | 本地复制为 | 用途 |
| --- | --- | --- |
| `kami.config.example.json` | `kami.config.json` | 监听地址、代理 |
| `.env.example` | `.env` | 可选环境变量 |

第一次 `pnpm dev` 如果还没有 `kami.config.json`，会自动从样板复制一份。代理、Cookie 都只留在本机。

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
src/lib/vault.ts                本机纸匣（IndexedDB）
src/lib/ugoira.ts               动图播放与 GIF 合成
src/lib/store.ts                设置、账号、队列
scripts/pack.py                 源码打包
kami.config.example.json        监听地址 / 代理样板（复制为 kami.config.json）
.env.example                    环境变量样板
.gitignore                      排除本机配置、依赖、构建产物
Dockerfile                      生产镜像
docker-compose.yml              一键启动
```

源站请求经由本机（或使用者自行部署的）服务端代理转发（Referer、Cookie、媒体）。浏览器不直连 Pixiv 图片 CDN。会话 Cookie 仅在该进程内短期使用；持久化位置仍是使用者本机。作者无法远程读取这些数据。

---

## 技术栈 🛠️

React 19、TanStack Router / Query / Start、Vite、Nitro、Tailwind CSS 4、Zustand、IndexedDB、fflate + gifenc。

一屋子优等生。

---

## 法律声明

**请完整阅读。使用、复制、部署或运行本软件，即视为已阅读并同意本节。若不同意，请立即停止使用并删除全部副本与本地数据。**

### 与权利人的关系

1. 本软件是独立的个人备份客户端，**不是** pixiv Inc.、pixiv FANBOX、yande.re、Konachan、Danbooru、SauceNAO、IQDB、TinEye 或「Pixiv 工具箱 Next」的官方产品、插件、合作方或授权版本。
2. 上述名称、商标、接口与内容的权利归其各自权利人。本文件中的提及仅为说明用途，不构成关联、代言或授权。
3. 项目作者、代码贡献者、文档撰写者，以及协助生成代码的人工智能服务提供方（包括但不限于 xAI / Grok），**均不是**使用者与任何第三方之间法律关系的当事人。

### 使用者的义务

4. 使用者必须自行遵守所在司法管辖区的法律，以及各源站的用户协议、版权政策与访问规则。
5. 仅允许保存使用者**已经有权查看**的内容，且仅供个人备份。禁止将本软件用于：转载、商用、二次分发、公开图床、批量爬取、绕过付费墙或订阅墙、盗用他人账号、传播违法内容。
6. 本软件**不会**解除 FANBOX 等平台的订阅限制。未订阅内容无法通过本软件合法取得附件。任何绕过尝试均属使用者自身行为。
7. 关于作品版权、邻接权、肖像权、平台条款的争议，由使用者自行面对权利人与主管机关。作者不代为交涉、应诉或赔偿。

### 免责

8. 本软件按「现状（AS IS）」提供，不附带任何明示或默示担保，包括但不限于适销性、特定用途适用性、不侵权、不中断或数据完整性。
9. 在适用法律允许的最大范围内，作者、贡献者及人工智能服务提供方对因下载、安装、配置、代理、登录、保存、丢失、泄露、滥用本软件或其中数据而产生的任何直接、间接、附带、惩罚性或后果性损害**不承担责任**，无论基于合同、侵权或其他法理。
10. 本文件中的过滤规则、安全提示与实现细节不构成法律意见、合规认证或安全审计结论。

### 成人内容与未成年人保护

11. R-18 开关由使用者自行打开。打开即表示使用者声明自己符合所在地法定年龄，并自行承担后果。
12. 客户端会尽力拦截部分与未成年人性化相关的标签（例如 loli、shota、toddlercon）。该列表无法穷尽，可被故意规避，也可能误伤。它**不是**对儿童性剥削内容的法律定义，也**不能**作为已合规的抗辩。
13. 禁止使用本软件寻求、保存或传播任何涉及未成年人的违法内容。一旦发现此类用途，作者与本项目不提供任何支持。

---

## 数据安全

1. **秘密不得入库。** `kami.config.json`、`.env`、`.data/`、浏览器本地存储中的 Cookie、代理口令、纸匣二进制，均视为使用者机密。仓库只提供 `kami.config.example.json` 与 `.env.example`。将真实配置推送到 git、网盘或聊天工具，风险由使用者承担。
2. **凭证即账号。** Pixiv `PHPSESSID`、FANBOX `FANBOXSESSID` 等同于登录。作者不会、也不能帮你吊销会话。泄露后须立即在源站退出全部会话并修改密码。
3. **数据不出本机。** 默认部署下，内容与凭证留在使用者控制的浏览器与进程中。若使用者把服务端口暴露到公网、反向代理到互联网、或与他人共享同一浏览器配置，等于主动交出数据。作者不运营公共服务器，不接收这些数据。
4. **代理是第三方。** 填写的 HTTP / SOCKS 代理将看到上游请求中的 Cookie 与资源 URL。请只使用本人控制或明确信任的代理。本项目不审核、不担保任何代理软件。
5. **本地存储会丢。** 纸匣使用 IndexedDB。卸载浏览器、清理站点数据、磁盘故障或恶意软件均可导致不可恢复的损失。需要长期保存时，由使用者自行导出到安全介质并自行加密。
6. **依赖与供应链。** `pnpm i` 将从 npm 等注册表拉取第三方包。其安全性不在本项目保证范围内。请在受控环境中安装，并自行核对锁文件。
7. **漏洞披露。** 若认为存在可导致他人凭证或本地数据被未授权读取的缺陷，请不要在公开 issue 中张贴秘密，自行负责任地告知维护者。修复前的风险由各部署方自负。

---

Kami Paperbox / Kami 纸匣。今天也要好好收纳喜欢的画呀 📦🌸

AI powered by [Grok](https://grok.com) · built with [Grok Build](https://x.ai) (xAI).

法律声明与数据安全条款约束整个项目；上列介绍性文字不减损其效力。