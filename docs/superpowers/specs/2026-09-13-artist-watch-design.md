# 画师更新追踪（A）设计

日期：2026-09-13 · 状态：已与用户确认通过（上限可调 + 存储占用注记为后补要求）
上游：新功能六方向 B→A→D→C→E→F 中的 A；B（纸匣智能库）已落地 PR #122
基线：main@bfdd8a9

## 目标与非目标

**做**：自选画师监控——画师页「追踪」，`/watch` 更新流页看每画师新作数与最新缩略图；一键导入 pixiv 关注列表；水位线标已读；侧栏/顶栏红点。按需检测 + 服务端缓存，不做后台定时轮询；页内红点，不做系统通知。

**不做**：关注动态流水位（翻页深会漏）、后台定时轮询（留给 F 剪报）、系统通知。

## 数据模型（设置段同步）

- `watchArtists: WatchArtist[]`：`{ source: "pixiv" | "fanbox", id, name, avatar, addedAt, lastSeenId?, lastCheckedAt? }`。
- `watchLimit: number`：用户可在设置页调整（夹取 20~500，默认 100）。
- 两者走 zustand persist + `parseBackupSettings` 往返 + 账号同步段（与 smartFolders 同通道）；`parseWatchArtists` 白名单清洗（source 合法、id 形状、字符串字段截断、上限内截取、坏项丢弃不连坐）。
- 水位线 `lastSeenId` 随设置同步：一台设备标已读，另一台不重复红点。

## 检测（零新后端）

- 追踪页打开时逐画师拉 `pixivUser(offset:0)`（返回含 `newestId`）或 `fanboxCreator` 首页；新作数 = 首页 items 中比 `lastSeenId` 新的条数（按返回顺序向下数到水位）。
- 并发 2；结果吃 `/api/source` 现有缓存（pixivUser 已进 sourceCacheKey，30 分钟 TTL）——不新增上游压力。
- 「标为已读」（单个/全部）= `lastSeenId` 写当前最新 id；检查失败的画师显示失败态（cookie 失效等），不计入红点。

## 新上游 op（唯一）

- `pixivMyFollowing(page)`：`GET ajax/my/following?offset&limit&lang=zh` → `{ items: { id, name, avatar }[], nextPage }`；`sourceCacheKey` 加键（uid + page）。用于「一键导入关注」（去重合并，超 watchLimit 截断并提示）。

## UI

- 画师页（pixiv/fanbox）头部「追踪/已追踪」toggle。
- `/watch`：按 addedAt 排列的画师行（头像/名字/新作数/检查状态）+「检查更新」「全部标为已读」「导入 pixiv 关注」；新作行内直接展示最新一张缩略图（复用现成 cover 数据）。
- 红点：桌面侧栏「追踪」项带角标；**移动端不动底部导航**（grid-cols-6 塞 7 项会挤爆，PR #111 事故），改顶栏铃铛带角标。角标数 = 各画师新作数之和（客户端 watch-store 本地状态）。
- 存储注记（用户要求）：追踪页与设置页注明「追踪会拉取并缓存各画师最新作品数据（`.data/source`，受缓存水位治理自动清理），追踪越多占用与流量越大」。
- 上限调整（用户要求）：设置页「存储」区加追踪上限数字输入（20~500，默认 100）；达上限时导入/追踪提示并截断。

## 错误处理

未登录提示「需要 pixiv/fanbox 凭据」；单画师失败不阻塞其余；取消追踪即删条目（水位一并删除）。

## 测试

`parseWatchArtists` 清洗与上限；新作计数 diff 纯函数（水位上/下/无水位）；`pixivMyFollowing` 映射；备份往返。UI 走 Playwright 冒烟。
