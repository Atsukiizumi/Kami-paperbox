# TD-19/14/15 债务清理：快照表清单、死引用、零引用依赖

## Goal

按优先级清理 docs/14-技术债务清单.md 中仅剩的三项活跃债务：TD-19（P1）→ TD-14（P3）→ TD-15 残余（P3）。

## Requirements

### TD-19（P1）快照表清单滞后
- db-snapshot 的 TABLES 硬编码清单缺 0003 新增的 user_sync_segments / user_sync_meta。
- 修法：① 增补两表；② 优先把清单模式改为「除 _migrations 外全量枚举」以绝后患；③ 补一条「写入 → 重启 → 恢复」回止单测，覆盖分段同步数据。
- 约束：exported_at 为 text 无需列转换；payload 已在 JSONB_COLUMNS。

### TD-14（P3）过时注释与死引用
- 清理 docs/reverse-engineering.md 中对已删除的 sniff-xhr.mjs 的引用。
- 顺手清理本轮触碰文件中的过时注释/死引用，不做全仓库大扫除。

### TD-15 残余（P3）零引用依赖
- 移除 package.json 中 cmdk / vaul / react-resizable-panels / jose 四个零引用依赖。
- jose 移除前需确认无间接依赖。

## Acceptance Criteria

- [ ] db-snapshot 导出包含 user_sync_segments / user_sync_meta，且未来新增表自动纳入（或清单有同步机制说明）
- [ ] 新增回归测试通过：分段同步数据写入后经快照导出/恢复不丢
- [ ] reverse-engineering.md 无已删除文件的死引用
- [ ] package.json 不再含四个零引用依赖，安装与构建正常
- [ ] npm run build / typecheck / 测试全部通过

## Notes

- 基线 main@23c40e3；完成后回写 docs/14 清单状态。
