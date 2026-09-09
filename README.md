# Kami 纸匣

<p align="center">
  <img src="public/og.jpg" alt="Kami Paperbox" width="100%">
</p>

<p align="center">
  <img src="public/x-banner.jpg" alt="Kami Paperbox banner" width="100%">
</p>

<p align="center">
  <a href="CHANGELOG.md"><img src="https://img.shields.io/badge/version-0.8.56-e8dfd2?style=flat-square&labelColor=0e0d0c" alt="version 0.8.56"></a>
  <img src="https://img.shields.io/badge/node-%3E%3D22-e8dfd2?style=flat-square&labelColor=0e0d0c" alt="Node.js >= 22">
  <img src="https://img.shields.io/badge/pnpm-10.15-e8dfd2?style=flat-square&labelColor=0e0d0c" alt="pnpm 10.15">
  <img src="https://img.shields.io/badge/react-19-e8dfd2?style=flat-square&labelColor=0e0d0c" alt="React 19">
  <img src="https://img.shields.io/badge/next.js-15-e8dfd2?style=flat-square&labelColor=0e0d0c" alt="Next.js 15">
  <img src="https://img.shields.io/badge/typescript-5.7-e8dfd2?style=flat-square&labelColor=0e0d0c" alt="TypeScript 5.7">
  <img src="https://img.shields.io/badge/tailwind-4-e8dfd2?style=flat-square&labelColor=0e0d0c" alt="Tailwind CSS 4">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-e8dfd2?style=flat-square&labelColor=0e0d0c" alt="MIT License"></a>
  <a href="https://grok.com"><img src="https://img.shields.io/badge/AI-powered_by_Grok-0e0d0c?style=flat-square&labelColor=e8dfd2&logo=x&logoColor=0e0d0c" alt="AI powered by Grok"></a>
</p>

**高速迭代中。** 功能和界面天天在改，这里不列清单。看变化去 [CHANGELOG.md](CHANGELOG.md)。

本项目仅供学习交流。个人备份，请尊重作者版权。

## 用法

### 跑起来

需要 Node.js 22+ 和 [pnpm](https://pnpm.io)。

```bash
pnpm i
pnpm dev      # 开发，http://localhost:8080
pnpm build    # 生产构建
pnpm start    # 生产服务，同样在 8080
```

Docker：

```bash
docker compose up --build
```

服务绑 `0.0.0.0`，局域网里用手机 / 平板打开 `http://<电脑 IP>:8080` 也能用。

**安全**：局域网不是可信网络，所以数据接口（纸匣读写、登录、代理设置等）都有访问闸——

- 开着应用账号（邮箱密码登录）：登录过账号的浏览器才能调数据接口。
- 没开应用账号（如 Docker 默认形态）：首次打开会弹出「需要配对令牌」，把启动纸匣的终端里 `[kami] 局域网访问令牌` 那一串贴进去即可；终端里也直接给了带令牌的配对链接（`#pair=…`），点开就完成配对。令牌存在服务端 `.data/lan-token.json`，怀疑泄露就删掉它重启，所有设备重新配对。

### 上手

- 公开内容开箱即看：Pixiv 日 / 周 / 月榜，yande.re、Konachan、Danbooru 的帖子，都不用登录。
- 推荐流、关注、红心、收藏要先登录：**设置 → 账号**，在弹出的官方登录页里登录，会话自动带回，不用手动贴 Cookie。FANBOX 的付费内容需要已订阅的 FANBOXSESSID。
- 图源在左上角切换；「过滤 AI」和「R-18」开关在浏览页顶部，按需打开。

### 日常

- **浏览**：悬停卡片放大预览，GIF / Pixiv 动图直接播。榜单有「刷新」，跳过缓存重新拉源站。
- **搜索**：空格分开多个标签；直接粘贴作品 / 画师链接也能跳。图站标签会显示中文。
- **搜图**：把图拖进窗口就能反搜（SauceNAO / ascii2d / IQDB / TinEye）。
- **下载 / 收入纸匣**：卡片上的按钮分别入队，进度在「队列」页看。纸匣优先写你在设置里选的用户文件夹。
- **纸匣 / 历史**：收进来的作品在「纸匣」页管理和导出；看过的自动记进「历史」。
- **备份**：设置里一键导出 / 导入设置、账号、纸匣目录、词表和浏览历史，不打包原图。

### 数据在哪儿

数据跟着跑服务的那台机器走，跟你从哪个 IP 打开无关：

| | 位置 | 说明 |
| --- | --- | --- |
| 纸匣目录 | `.data/vault/` | SQLite + 原图文件 |
| 封面缓存 | `.data/media/` | pximg / 图站图，7 天 |
| 列表缓存 | `.data/source/` | 日榜、图站、关注、推荐、FANBOX，30 分钟 |
| 用户文件夹 | 设置里选的目录 | 收入纸匣时优先写这里 |
| 浏览列表 | 浏览器 localStorage | 够一屏（约 50 张），刷新先画浏览器再问服务端 |

Docker 部署时以上 `.data` 都在 `kami-data` 卷里。更细的落盘说明见 [docs/storage.md](docs/storage.md)。

## 鸣谢

- [yande-re-chinese-patch](https://github.com/zhzwz/yande-re-chinese-patch)
- [EhTagTranslation/Database](https://github.com/EhTagTranslation/Database)
- [PixEz](https://github.com/Notsfsssf/pixez-flutter)
- [Grok](https://grok.com)
- [ZCode](https://z.ai)

## 许可证

[MIT](LICENSE)
