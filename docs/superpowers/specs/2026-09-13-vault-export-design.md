# 纸匣打包导出（E）设计

日期：2026-09-13 · 状态：已实现（feat/vault-export）
上游：六方向 B→A→D→**C（不做：用户拍板 AI 补译应走服务端，暂缓整档）**→E→F；B/A/D 已落地（#122/#123/#124）
基线：main@30c7de2

## 目标与非目标

**做**：纸匣页按当前筛选结果一键导出 zip——服务端流式打包 `.data/vault` 里的原图文件，按画师分文件夹；缺图条目跳过并写入包内 `_skipped.json`。

**不做**：离线 HTML 画廊（用户选纯 zip）、缺图现场补拉、在线分享页。

## 架构

- **服务端打包**（对齐「文件在哪侧哪侧处理」）：`POST /api/vault/export` `{keys: string[]}`（个人面 withDataPlane，上限 500 key）→ 校验条目存在且有首页文件 → `fflate`（纯 JS，新增依赖）流式 zip：`ReadableStream` 边压边吐，响应 `application/zip`。不整包进内存。
- **zip 结构**：`<safeAuthor>/<safeTitle>_<source>_<id>_p<i>.<ext>`（safeSeg 复用现有清洗；重名由 source+id 保证唯一）；包内 `_skipped.json`：`{reasons: {key, reason}[]}`。
- **客户端**：纸匣页头部「导出 ZIP」按钮（筛选结果非空即可用）→ 收集当前筛选条目 keys → POST → `res.blob()` 触发下载。导出前按 meta.bytes 合计预估体积，>500MB toast 建议分批。

## 错误处理

- key 不存在 / 无文件：进 `_skipped.json`（reason: missing|no-file），不影响其余打包。
- 服务端读文件失败：该文件跳过，记录 reason:read-error。
- keys 超上限 400。

## 测试

- 路由纯逻辑拆 `buildExportEntries(store, keys)`（返回 entries + skipped）单测：临时 vault store 造 3 条（1 缺文件）→ 断言分组。
- zip 打包本身信任 fflate；UI 走手动 QA（下载 zip 能解压、结构正确）。
