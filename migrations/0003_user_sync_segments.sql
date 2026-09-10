-- 账号同步分段化（TD-09/18）+ 同步加密的 KDF salt（SEC-03 第二刀，docs/17）。
-- user_sync 旧单行表保留：拉取侧兼容读取，客户端首次推送后自然迁到分段表。

create table if not exists user_sync_segments (
  user_id text not null,
  segment text not null,
  payload jsonb not null,
  exported_at text not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, segment)
);

create table if not exists user_sync_meta (
  user_id text primary key,
  kdf_salt text not null,
  updated_at timestamptz not null default now()
);
