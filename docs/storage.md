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

`pnpm dev` / `pnpm start` 就是这台 Node 服务器。Docker 把 `.data` 做成数据卷。Vercel 不能写磁盘，收入时自动只用 IndexedDB。

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

## 7. 不做的事

- 不把原图像素放进 SQLite。
- 不上 Neo4j / Dgraph / 其它图服务。关系要用边，就加 SQLite 表。
- 不把纸匣同步到云。数据只留在跑 Node 的那台机器（以及你选的文件夹）。
- 队列仍在浏览器里跑：关掉标签页会停。要把排队也挪到 Node 进程，另开需求。
