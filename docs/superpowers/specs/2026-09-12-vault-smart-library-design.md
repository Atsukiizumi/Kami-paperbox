# 纸匣智能库（B）设计

日期：2026-09-12 · 状态：已实现（feat/vault-smart-library）
上游：新功能头脑风暴（六方向 A~F，顺序 B → A → D → C → E → F，本文档为 B）
基线：main@95ea0a6

## 目标与非目标

把纸匣从「平铺列表」升级成「可管理的库」：组合检索、同图不同源查重、收藏统计。

**做**：标签筛选、月份时间轴筛选、智能文件夹（命名筛选条件）、感知哈希查重（只标记 + 手动逐组处理）、统计面板（分布三图/收藏时间线/存储占用/查重状态）。

**不做**：组合查询语法（author:xxx tag:1girl 式）、自动合并重复、webp 解码（记 NULL 跳过，覆盖率如实显示）、图表库（CSS/SVG 条形即可）、定时自动扫描。

## 架构：按数据所在侧分工

- 原图文件在服务端 → 哈希计算、查重聚类、存储占用聚合在**服务端**（vault-store SQLite + 新 API）。
- 收藏 meta 全量同步在浏览器 → 检索筛选、智能文件夹、分布统计/时间线在**客户端**（vault-query 扩展 + 新统计页），保持现有「输入即筛」手感。

## 数据模型（vault-store SCHEMA 内建表；侦察修正：vault SQLite 建表内联在 vault-store.server.ts，migrations/ 是账号库）

- `vault_hash(key TEXT PK, dhash TEXT NOT NULL, w INTEGER, h INTEGER, computed_at TEXT)`：dHash 为 64-bit hex。key 对应收藏条目；解码失败的条目不落行（而非 NULL 行）。
- `vault_dup_dismissed(pair TEXT PK, created_at TEXT)`：pair = 排序后 `a|b`。**不建重复组表**——组由扫描时按距离动态聚类，只有人的决定（忽略对）才持久化。
- db-snapshot 自 TD-19 起动态枚举 public 表：新表自动纳入快照/恢复，零改动。

## 哈希计算

- dHash 8×8：解码 → 9×8 灰度 → 相邻比较得 64 bit。缩放/轻微裁剪鲁棒，适合「同图不同源」判定。
- 解码依赖：`jpeg-js` + `pngjs`（纯 JS，小体积；不引 sharp/canvas）。
- 时机：收藏写入（PUT /api/vault）时对第一页顺手算；老存量由扫描 API 补算，分批 setImmediate yield（沿用 PER-11 模式）防事件循环阻塞。
- 阈值：汉明距离 ≤ 10 为候选对（扫描时可调）。

## API（个人面 withDataPlane，不开 guest）

- `POST /api/vault/dedup/scan` `{threshold?}`：补算缺失哈希并返回候选组（排除已忽略对）。扫描不落库结果——候选组由哈希现场重算（毫秒级）。
- `GET /api/vault/dedup`：按已存哈希现场重算候选组（组 = 聚类的 key 列表 + 每组距离）；忽略对即时生效。
- `POST /api/vault/dedup/dismiss` `{a, b}`：忽略一对。
- 删除条目复用现有 `DELETE /api/vault?key=`。
- `GET /api/vault/stats/storage`：walk `.data/vault`，按来源/画师聚合字节数（异步分批）。

## 客户端

- `vault-query.ts`：`filterVaultItems` 增加 `tags`（任一命中）与 `month`（YYYY-MM）谓词；智能文件夹 = `{name, text?, tags?, source?, month?}`，存设置段（zustand + 现有账号同步），纸匣侧栏列出、点击套用。
- 新路由 `/vault/stats`：来源占比 / 画师 Top / 标签 Top（客户端聚合 meta）、按月收藏时间线、存储占用卡片（服务端 API）、查重状态卡（哈希覆盖率 = 有哈希条目/总条目、候选组数、「去处理」入口）。
- 纸匣页「查重」视图：候选组组内并排卡片（标注来源与距离），动作 = 删除（复用现有删除+toast）/ 忽略本对。

## 错误处理

- 解码失败 / webp / 动图首帧非 jpg-png → 无哈希，不阻塞收藏主流程；覆盖率在统计页如实显示。
- 扫描大库存分批推进，可重复触发（幂等：哈希已存在的条目跳过）。
- 空结果明确显示「没有发现重复」。

## 测试

- dHash 纯函数：同图不同尺寸 → 距离小；异图 → 距离大；jpeg/png 解码路径。
- pair 聚类纯函数：三角关系（A~B、B~C、A⊉C）的分组行为。
- `filterVaultItems` tags/month 谓词；智能文件夹条件序列化往返。
- vault-store 层：哈希写入/读取、dismiss 持久化、扫描补算幂等。
- 不新增 e2e（纯个人面，现有手动 QA 覆盖）。

## 后续衔接

B 完成后依次：A 画师更新追踪 → D 批量收藏 → C 本地 AI 标签（语义搜图踩在本库上）→ E 打包分享（按画师/合集切片受益于本库）→ F AstrBot 剪报对接。
