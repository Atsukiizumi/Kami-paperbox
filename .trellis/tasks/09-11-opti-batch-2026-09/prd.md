# 优化批次：文档同步→CI Docker 门禁→S7→M6→M7→维护 PR

## Goal

按用户指定顺序，逐项完成 2026-09-11 复核后的剩余优化项。①~⑤ 每项独立提交直接进 main（用户已许可不开 PR）；⑥ 维护升级按仓库惯例开独立 PR。每完成一项向用户简报后再进下一项。

## Requirements（按执行顺序）

### ① 文档口径同步
- docs/16：S9 标记 ✅（TD-19 已修：全量枚举 + FK 拓扑排序 + 回归测试）；短期完成判定「分段同步数据跨重启存活 ⬜」改 ✅；M4 措辞去掉「TD-15 又发现 4 个零引用」（已移除）。
- docs/15：R-02 拍板回写——用户已决定**不加** FANBOX 付费通道默认关闭选项，维持现状（保持个人使用定位）。

### ② CI 加 Docker 构建门禁
- ci.yml 增加 docker build 步骤（只构建不推送），防止 .dockerignore / 构建上下文类回归。
- GHCR 推送：仅在不引入密钥管理负担时顺带做；否则记为后续项。

### ③ S7 错误可观测性最小版
- 吞异常处统一 `[module:op]` 前缀 console.warn。
- /api/source 区分上游 502 与参数 400。

### ④ M6 队列体验
- 可配置并发（>1）、失败自动重试（指数退避）、跨标签页共享（BroadcastChannel）。

### ⑤ M7 E2E 框架化
- qa-*.mjs 收编进 playwright.config；关键路径（浏览→详情→入队→纸匣）进 CI。

### ⑦ 访客层（用户 2026-09-11 追加）
- 应用账号开启但未登录的访客可用公开内容面：浏览 / 榜单 / 图片 / 搜图 / 收藏操作（social）。
- 访客凭据（Pixiv Cookie 等）只存其浏览器 localStorage、随请求体带上，不落服务端（现状语义，闸门放行后即可用）；「为你推荐 / 关注」键于浏览器本地 Pixiv Cookie 自动可用/置灰。
- 个人面（纸匣、会话同步、登录中转、账号同步）仍要会话；榜单归档访客只读（GET）。
- 账号关闭形态（LAN 令牌）不受影响。

### ⑥ 维护升级 PR
- Next 16 / TS 7 / better-auth 1.7；独立 PR，CI 绿后合并。不可解的不兼容时停下报告，不自行绕过。

## Acceptance Criteria

- [ ] docs/15、16 与代码现状一致，R-02 拍板已记录
- [ ] CI 含 docker build 门禁且在 main 通过
- [ ] S7 完成：吞异常处带 `[module:op]`；/api/source 502/400 区分且有测试
- [ ] M6 完成：并发可配 + 指数退避重试 + BroadcastChannel，有测试，CHANGELOG 记录
- [ ] M7 完成：playwright.config 收编 qa 场景，CI 可跑
- [ ] 访客层：匿名可浏览/榜单，vault/登录中转仍 401；e2e guest-tier 用例通过
- [ ] 维护升级 PR 合并，门禁全绿
- [ ] 每项独立提交；全部完成后 CHANGELOG 与 docs 终态回写

## Notes

- 用户已拍板 R-02 不加选项——本批次不含任何 FANBOX 付费通道行为改动。
