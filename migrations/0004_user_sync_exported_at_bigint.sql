-- TD-30：exported_at 类型统一——0003 把 user_sync_segments.exported_at 建成
-- text（毫秒字符串），与 0002 user_sync 的 bigint 漂移；SQL 级 order by/比较
-- 在 text 列按字典序出错。统一为 bigint（毫秒），USING 强转存量数据；
-- 读写侧 Number(...) 对 string|number 均兼容，无需应用层变更。
alter table user_sync_segments
  alter column exported_at type bigint using exported_at::bigint;
