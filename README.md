# Kami 纸匣

<p align="center">
  <img src="public/og.jpg" alt="Kami Paperbox" width="100%">
</p>

<p align="center">
  <img src="public/x-banner.jpg" alt="Kami Paperbox banner" width="100%">
</p>

<p align="center">
  <a href="CHANGELOG.md"><img src="https://img.shields.io/badge/version-0.8.60-e8dfd2?style=flat-square&labelColor=0e0d0c" alt="version 0.8.60"></a>
  <img src="https://img.shields.io/badge/node-%3E%3D22-e8dfd2?style=flat-square&labelColor=0e0d0c" alt="Node.js >= 22">
  <img src="https://img.shields.io/badge/pnpm-10.15-e8dfd2?style=flat-square&labelColor=0e0d0c" alt="pnpm 10.15">
  <img src="https://img.shields.io/badge/react-19-e8dfd2?style=flat-square&labelColor=0e0d0c" alt="React 19">
  <img src="https://img.shields.io/badge/next.js-16-e8dfd2?style=flat-square&labelColor=0e0d0c" alt="Next.js 16">
  <img src="https://img.shields.io/badge/typescript-6-tsgo-e8dfd2?style=flat-square&labelColor=0e0d0c" alt="TypeScript 6 (tsgo)">
  <img src="https://img.shields.io/badge/tailwind-4-e8dfd2?style=flat-square&labelColor=0e0d0c" alt="Tailwind CSS 4">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-e8dfd2?style=flat-square&labelColor=0e0d0c" alt="MIT License"></a>
  <a href="https://grok.com"><img src="https://img.shields.io/badge/AI-powered_by_Grok-0e0d0c?style=flat-square&labelColor=e8dfd2&logo=x&logoColor=0e0d0c" alt="AI powered by Grok"></a>
</p>

**高速迭代中。** 功能和界面天天在改，这里不列清单。看变化去 [CHANGELOG.md](CHANGELOG.md)。

本项目仅供学习交流。个人备份，请尊重作者版权。

## 启用

### 本机跑

需要 Node.js 22+ 和 [pnpm](https://pnpm.io)。

```bash
pnpm i
pnpm dev      # 开发，http://localhost:8080
pnpm build    # 生产构建
pnpm start    # 生产服务，同样在 8080
```

首次打开会提示「需要配对令牌」：把启动终端里 `[kami] 局域网访问令牌` 那一串贴进去，或直接点终端里给出的配对链接（`#pair=…`）。

### Docker 使用

```bash
docker compose up --build
```

- 打开 `http://localhost:8080`；同一局域网的手机 / 平板用 `http://<电脑 IP>:8080`。
- 镜像默认要登录应用账号：首次打开先注册一个邮箱账号。不想开账号，把 `docker-compose.yml` 里 `VITE_AUTH_ENABLED` 改成 `"false"` 再重新构建，届时改用上面的配对令牌方式。
- 令牌存在服务端 `.data/lan-token.json`，怀疑泄露就删掉它重启，所有设备重新配对。
- 所有数据都在 `kami-data` 卷里（容器内 `.data/`）。

### 数据在哪儿

数据跟着跑服务的那台机器走，跟你从哪个 IP 打开无关：

| | 位置 | 说明 |
| --- | --- | --- |
| 纸匣目录 | `.data/vault/` | SQLite + 原图文件 |
| 封面缓存 | `.data/media/` | pximg / 图站图，7 天 |
| 列表缓存 | `.data/source/` | 日榜、图站、关注、推荐、FANBOX，30 分钟 |
| 用户文件夹 | 设置里选的目录 | 收入纸匣时优先写这里 |

Docker 部署时以上 `.data` 都在 `kami-data` 卷里。更细的落盘说明见 [docs/storage.md](docs/storage.md)。

## 鸣谢

- [yande-re-chinese-patch](https://github.com/zhzwz/yande-re-chinese-patch)
- [EhTagTranslation/Database](https://github.com/EhTagTranslation/Database)
- [PixEz](https://github.com/Notsfsssf/pixez-flutter)
- [Better Auth](https://github.com/better-auth/better-auth) —— 应用账号与会话
- [PGlite](https://github.com/electric-sql/pglite) —— 内嵌账号库
- [undici](https://github.com/nodejs/undici) —— 上游持久连接池
- [Playwright](https://github.com/microsoft/playwright) —— 浏览器验收脚本
- [Grok](https://grok.com)
- [ZCode](https://z.ai)

## 许可证

[MIT](LICENSE)
