# E-R 图

- **目的**：全部持久化实体的关系与基数（PK/FK/核心字段）。
- **依据**：migrations/*.sql + vault-store.server.ts + ranking-store.server.ts（优先级：数据库实际结构 > Migration > 业务代码推导）。
- **基线**：`main@75e7de0`。

## 1. 账号库（Postgres/PGlite，migrations/）

```mermaid
erDiagram
  user ||--o{ session : "拥有 (FK CASCADE)"
  user ||--o{ account : "绑定 (FK CASCADE)"
  user ||--|| user_sync : "legacy 整份 (无FK)"
  user ||--o{ user_sync_segments : "分段同步 (无FK)"
  user ||--|| user_sync_meta : "KDF salt (无FK)"

  user {
    text id PK
    text name
    text email UK
    boolean emailVerified
    text image
    timestamptz createdAt
    timestamptz updatedAt
  }
  session {
    text id PK
    text token UK
    timestamptz expiresAt
    text userId FK
    text ipAddress
    text userAgent
  }
  account {
    text id PK
    text providerId
    text accountId
    text userId FK
    text password "邮箱密码通道"
    text accessToken
  }
  user_sync {
    text user_id PK
    jsonb payload "legacy 明文仍可入 (SEC-14)"
    bigint exported_at "类型与 0003 不一致 (TD-30)"
  }
  user_sync_segments {
    text user_id PK "复合PK(user_id,segment)"
    text segment PK "settings|vault|lexicon|history"
    jsonb payload "cipher 容器或 plain"
    text exported_at "毫秒字符串 (TD-30)"
  }
  user_sync_meta {
    text user_id PK
    text kdf_salt "base64, conflict 不覆盖"
  }
```

## 2. 收藏库（SQLite，.data/vault/vault.sqlite）

```mermaid
erDiagram
  works ||--o{ pages : "key 关联 (无声明式FK)"

  works {
    text key PK "source:id 禁点号"
    text source
    text title
    text author
    text tags "JSON ≤80"
    integer saved_at "epoch ms"
    integer bytes
    text relative_path "用户文件夹镜像"
  }
  pages {
    text key PK "复合PK(key,page)"
    integer page PK "0 起"
    text ext
    text path "files/{source}/{id}/{n}.{ext}"
  }
```

## 3. 榜单库（SQLite，.data/rankings/rankings.sqlite）

```mermaid
erDiagram
  snapshots {
    text id PK "site:period:date"
    text site
    text period "daily|weekly|monthly"
    text date
    integer fetched_at
    text items "WorkCard[] JSON ≤200"
  }
```

## 4. 简化全局关系

```mermaid
flowchart LR
  A[user 应用账号] --- B[user_sync 分段×4<br>（KEK 密文 settings）]
  C[works 纸匣条目] --- D[pages 原图页]
  E[snapshots 榜单快照]
  F[浏览器 IndexedDB<br>kami-vault 镜像] -.->|最终一致| C
  G[localStorage settings] -.->|KEK 加密上送| B
```

**关系业务意义**：user→session/account 是 better-auth 标准三表（级联删除）；user_sync 系列无 FK 是有意为之——快照恢复需要灵活插入顺序（FK 拓扑排序在应用层做）；works→pages 的 key 复合关联支撑原子写协议；snapshots 独立无关系（纯归档）。

**风险点**：① user_sync 三表无 FK，scope 全靠 requireUserId（12 号）；② exported_at 两表类型不一致（TD-30）；③ vault 浏览器镜像与服务端最终一致无冲突检测（06 号 6.5）。
