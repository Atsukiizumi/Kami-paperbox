-- 应用账号的服务端同步：每个用户一份备份 JSON，换浏览器登录后恢复。
create table if not exists user_sync (
  user_id text primary key,
  payload jsonb not null,
  exported_at bigint not null,
  updated_at timestamptz not null default now()
);
