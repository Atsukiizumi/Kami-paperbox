# 纸匣怎么存

纸匣要记住两件事：**这张图是谁**，以及**像素在哪**。前者用 SQLite 一行元数据，后者用普通图片文件。没有图数据库。

---

## 1. 三层各管什么

```
浏览 / 保存
    │
    ├─ 浏览器 IndexedDB `kami-vault`     预览缓存（关 Node 也能翻）
    ├─ 本机 Node `.data/vault/`          真正的目录（SQLite + 原图）
    └─ 可选：用户选的文件夹              按路径模板再拷一份，方便在资源管理器里翻
```

| 层 | 路径 | 存什么 | 清掉会怎样 |
| --- | --- | --- | --- |
| Node 目录 | `.data/vault/vault.sqlite` | 标题、作者、标签、页数、体积、相对路径 | 搜不到，文件还在 |
| 原图文件 | `.data/vault/files/{站点}/{id}/{页}.{ext}` | jpg / png / gif（动图合成失败时可能是 zip） | 预览和导出没了 |
| 浏览器 | IndexedDB `meta` + `blobs` | 同一份元数据 + Blob | 清站点数据会丢缓存；Node 目录还在 |
| 用户文件夹 | 设置里选的目录 | 按 `{author}/{date}/…` 规则镜像 | 只影响那份拷贝 |

`pnpm dev` / `pnpm start` 就是这台 Node 服务器。Docker 把 `.data` 做成数据卷。只读盘环境（如 serverless）不能写磁盘，收入时自动只用 IndexedDB。

Next 服务端缓存（跟你从哪个 IP 打开无关，key 不是 `http://192.168.x.x`）：

| 层 | 路径 | 存什么 | TTL |
| --- | --- | --- | --- |
| 封面 | `.data/media/{sha256}.bin` | pximg / 图站图 | 7 天 |
| 列表 | `.data/source/{sha256}.json` | 日榜、图站、关注、推荐、FANBOX 列表 | 30 分钟 |
| 浏览 | 浏览器 localStorage `kami-browse-v2`（键含凭据指纹，不含 Cookie 原文——SEC-04） | 首页够一屏（约 50 张，含关注 / 推荐 / FANBOX） | 30 分钟后后台问 Next，24 小时丢掉 |

读的顺序：浏览器 localStorage → Next `.data`（及 `unstable_cache`）→ 源站。列表 key 用账号 id，不用 Cookie 原文、不用访问 IP。浏览页点「刷新」会带 `fresh`，跳过这两层，重新打源站并覆盖盘上的列表。作品详情（`pixivIllust` / `fanboxPost`）和搜图引擎不进列表缓存。FANBOX 投稿正文图也不进封面盘。换 IP 仍问本机 Next，命中就不打源站。

---

## 2. 为什么图是文件，库只存字

原图像素以 **jpg / png / gif** 落盘，不塞进 SQLite。

- 任意看图软件都能打开，备份、rsync、按作者归档都是普通文件操作。
- SQLite 只对「谁、叫什么、带什么 tag」建索引，库保持很小，搜索才快。
- 只存源站 URL 不行：Pixiv 图链会过期，还要 Cookie。
- 把 BLOB 塞进 SQLite 会让库迅速膨胀，增量备份也难。

动图例外：能合成时存一张 GIF；合成失败才留下 ugoira zip。

---

## 3. 为什么不是 graph 数据库

作品、作者、标签、相关作品**概念上是一张图**：

```
作者 ──创作──► 作品 ──带──► 标签
                │
                └──相关──► 其他作品
```

但纸匣**不用 Neo4j / 其它图引擎**，用关系表。

| 需求 | SQLite | 图数据库 |
| --- | --- | --- |
| 按标题、作者、路径搜 | 合适 | 能做，偏重 |
| 「这个 tag 下还有谁」 | `work_tags` 多对多就够 | 顺手 |
| 「从这张图走两步相关」 | JOIN / 递归 CTE | 更顺 |
| 本机部署 | Node 22 自带 `node:sqlite` | 又多一个服务 |

当前表结构是一张 `works`（JSON 里带着 tags 数组）+ 一张 `pages`（每页文件路径）。搜索走 `vault-query.ts`：关键字分词后命中标题、作者、标签、id、相对路径。

如果以后要做「点作品 → 作者 → 标签云」或相关推荐，仍然加边表即可，不必换引擎：

```
works
authors
tags
work_tags      (work_key, tag)
work_related   (from_key, to_key)
```

图算法（社区发现、推荐路径）可以在这些边上算。现在没有这些表，标签只存在 `works.tags` 的 JSON 里。

---

## 4. 文件布局

```
.data/vault/
  vault.sqlite
  files/
    pixiv/
      12345678/
        0.jpg
        1.jpg
    fanbox/
      987/
        0.png
    yande/
      111/
        0.jpg
.data/backups/          # 云备份的本地痕迹（凭据与状态，不含备份本体）
  cloud-target.json     # 连接信息（协议/地址/凭据/定时配置）——凭据只存这里
  backup-state.json     # 引擎运行态（最近成功/失败、进度、孤儿计数）
  tmp/                  # VACUUM INTO 暂存，备份完即删
```

作品主键是 `站点:id`，例如 `pixiv:12345678`。路径段只允许 `[A-Za-z0-9._-]`，防止目录穿越。

用户文件夹是另一棵树，规则见设置里的路径模板（`{author}` `{date}` `{title}` …）。那份路径会写回 `works.relative_path`，所以按文件夹名也能搜到，即使文件已经铺了几千个目录。

---

## 5. 写入顺序

`archiveWork`（`persist-files.ts`）：

1. 浏览器 `saveVaultWork` → IndexedDB（立刻能预览）
2. 若选了文件夹 → 按模板镜像，并把相对路径补进 meta
3. `pushVaultToServer` → `PUT /api/vault`（FormData：meta JSON + `page_0`…）
4. Node `vault-store.server.ts` 写 SQLite + `files/…`

读的时候纸匣页先 `GET /api/vault`；失败再读 IndexedDB。某一页原图：先 IndexedDB，没有再 `GET /api/vault?key=&page=`。

删除两边都删。

设置「备份」导出 JSON：账号、纸匣目录、词表、历史。不含原图像素。导入会覆盖设置和账号，纸匣记录按编号合并。用户文件夹授权导不走，导入后要重新选一次文件夹。

---

## 6. HTTP

实现：`src/routes/api/vault.ts`。只在本机 Node 上有意义。

| | |
| --- | --- |
| `GET /api/vault` | 健康检查 + 列表（`?text` `?source` `?author`） |
| `GET /api/vault?key=&page=` | 某一页原图 |
| `PUT /api/vault` | 收入。`meta` JSON + `page_0`… 文件 |
| `PATCH /api/vault` | 补相对路径 / 文件夹名 |
| `DELETE /api/vault?key=` | 删记录和文件 |

代码落点：

- `src/lib/vault-store.server.ts` — SQLite + 写盘
- `src/lib/vault-sync.ts` — 浏览器推送 / 拉取
- `src/lib/vault.ts` — IndexedDB 缓存
- `src/lib/vault-query.ts` — 纯函数过滤（Node 测试和浏览器共用）

---

## 7. 云备份（纸篓批）

纸匣本体不动，但可以把整份纸匣定时**备份到你自己的云盘**（WebDAV 或 S3 兼容）。三条铁律：

- **未连接云存储 = 没有备份**：没有连接引导之外的任何备份产物与定时活动。
- **连接 ≠ 开启**：连上后定时备份默认关闭，要在 设置 → 存储 → 云备份 里显式打开（「立即备份」随时可用，是显式动作）。
- **云端永不自动删**：本地删掉的文件（含纸篓清空）在云端保留为「孤儿」，卡上只报计数，清不清你说了算——备份系统跟着源删是容灾大忌。

云端目录布局：`catalog/vault-meta-<时间戳>.sqlite`（滚动保留 N 份）+ `files/…`（按 vault 内相对路径原样镜像）+ `manifest.json`（增量清单，按 path+size+mtime diff，只传新增/变更；藏品文件落盘即不可变）。增量中断可直接重跑，已传过的不会重传。

删除改软删除：`works.deleted_at`（毫秒时间戳，NULL=在匣）。删除进「纸篓」，文件与 pages/hash 行原样保留；还原=摘标记（saved_at 不变）；只有纸篓里「彻底删掉/清空」才走真删（文件+行+哈希全清）。重新收入纸篓里的同 key 作品会直接出篓。

**恢复演练**（换机器 / 灾难）：

```bash
# 1. 装好同版本应用后停掉；2. 预览云端有什么：
pnpm vault-restore
# 3. 确认后真恢复（覆盖 .data/vault/vault.sqlite 与 files/）：
pnpm vault-restore --yes
# 4. 启动应用，核对藏品数量与封面。
```

## 8. 不做的事

- 不把原图像素放进 SQLite。
- 不上 Neo4j / Dgraph / 其它图服务。关系要用边，就加 SQLite 表。
- 平台不「同步到云」：云备份是把你自己的纸匣**备份到你自己的云盘**，不是账号漫游。
- 队列仍在浏览器里跑：关掉标签页会停。要把排队也挪到 Node 进程，另开需求。
