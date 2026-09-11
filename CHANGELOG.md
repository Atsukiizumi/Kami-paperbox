# 更新日志

本文件记录 Kami 纸匣的用户可见变化，格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)。版本号大致遵循 [SemVer](https://semver.org/lang/zh-CN/)。

之后每次改动都会开 Pull Request，合并进 `main` 后再把条目写到这里。

## [Unreleased]

### 性能

- 修浏览页点开详情的长卡顿：一屏卡片图同时把同源连接占满（HTTP/1.1 每源 6 条），路由和详情数据请求排在图片后面，实测点击到跳转最长等过 10 秒。现在浏览器侧图片加载统一走全局 4 条「车道」，给导航和数据请求永远留出连接；卡片悬停预取的缓存键与详情页对齐（原先键不一致，悬停预取一直没生效），点开即出内容。

### 修复

- 移动端底部导航不再挤成一团：此前七个入口塞在六格网格里，列宽被压扁、高亮指示条错位。现在移动端固定六项（浏览 / 热榜 / 历史 / 搜图 / 纸匣 / 设置），队列入口只在桌面侧栏出现（带计数徽标）；手机上正在队列页时底部不高亮任何项，收藏的纸片动画自动跳过。
- 本机 / Docker 形态（PGlite）重启不再丢服务端账号同步数据：数据库快照此前只导出固定的四张表，分段同步表（user_sync_segments / user_sync_meta）不在其中，重启后换设备恢复会拿到空段；现改为除迁移记录表外全表自动纳入（新表天然覆盖），恢复时按外键依赖先插父表，登录会话与账号绑定同样受保护。
- 详情页红心 / 收藏的乐观更新一直写在不匹配的缓存键上，列表和详情的联动状态靠服务端返回才对上；现统一走同一份键。
- 应用账号登录不再「重启即掉线」：本地没设 `BETTER_AUTH_SECRET` 时会话签名密钥每次重启随机重生成，旧 Cookie 签名全部失效。现在密钥落在 `.data/auth-secret.json`，和服务端会话快照同生共死（升级后需重新登录一次，之后跨重启保持）。
- 浏览页 Pixiv 榜单的日期选择框从搜索行挪到榜单行最右、紧挨刷新按钮，与 Yande 等图站的工具栏布局一致；顺带去掉旁边重复的日期文本。

### 新增

- 右上角账号入口重做：未登录时是应用账号登录入口（弹窗里登录 / 注册）；登录后显示邮箱和登录状态，下拉里可登出、切换本机绑定的 Pixiv / FANBOX 图站账号（没有绑定时显示空态）。匿名形态（`VITE_AUTH_ENABLED=false`）保持原来的图站账号切换器。

### 文档

- README 精简到只讲本机启用与 Docker 用法。

## [0.8.60] — 2026-09-10

对应 [PR #107](https://github.com/Atsukiizumi/Kami-paperbox/pull/107)、[PR #108](https://github.com/Atsukiizumi/Kami-paperbox/pull/108)、[PR #109](https://github.com/Atsukiizumi/Kami-paperbox/pull/109)。

### 安全（第三批）

- 浏览列表的本地缓存不再含登录凭据明文（SEC-04）：react-query 的缓存键原先直接放 Cookie 原文，会随浏览缓存写进 localStorage——换成不可逆指纹，旧的污染存储读到即删。
- 备份文件支持口令加密（SEC-03）：导出时填口令，「设置 + 代理地址」整段以 PBKDF2 + AES-GCM 密文保存（v2 格式），外发 / 进云盘的备份拿不到口令读不出会话；不填口令仍是明文 v1，旧文件永远可直接导入。
- 账号同步分段加密（SEC-03 + TD-09/18）：服务端存储按「设置 / 纸匣目录 / 词表 / 历史」四段各自记录时间点，多设备不再整份互相覆盖；设置段（含各图站登录与代理密码）以密文落库，密钥由账号密码在登录瞬间派生、只存于浏览器会话。换设备登录即恢复的用法不变。设计全文见 docs/17。

### 体验与工程（第三批）

- 翻页不再被安全模式误判成末页：booru 列表 / Pixiv 搜索改用过滤前的原始条数判断「还有下一页」。
- 队列下载进度改为 200ms 合并一拍：百页作品入队不再刷爆界面和本地存储。
- 纸匣大库分批渲染：先出 60 张、滚动到底继续，配图在滚动中续载。
- 纸匣 / 历史热榜页快速切换时不再被旧响应闪回。
- Docker 镜像默认开启应用账号（compose 里一行改回纯浏览形态）；删掉 recharts 等三个零引用依赖；工程注释与文档全面同步。


### 安全（第二批）

- 账号同步的推送载荷过备份导入同款校验（SEC-09）：此前任意形状的 JSON（≤2MB）都能写进服务端同步存储，现在不合法直接 400。
- Grok 平台完全退出（SEC-05 随之消除）：硬编码在源码里的 preview client secret、broker 联邦登录、popup 通道、品牌注入中间件等平台烙印整体删除；鉴权只剩邮箱密码一条通道。
- 修好手机 / 平板从局域网 IP 登录被 403 的存量缺陷：Better Auth 的 Origin 信任改为「与请求自身 Host 一致的同源放行」，真正的跨站脚本请求仍然被拒。
- 依赖 audit 清零：postcss ×4 + js-yaml 共 5 个已知 CVE，其中 postcss 的 4 条来自 next 钉死的 8.4.31（用作用域 override 顶到 8.5.28）。

### 工程与可靠性（第二批）

- 包管理统一 pnpm（TD-06）：提交 pnpm-lock.yaml、Dockerfile 改 corepack、CI 换 pnpm，删掉 package-lock.json——本机与镜像依赖树从此一致、构建可复现。
- 纸匣写入原子化（TD-08）：收入作品先全部写同目录暂存、rename 原子就位、目录与页面行同事务落库；中途断电 / 强杀不再留半文件或丢旧副本，崩溃残留的暂存下次写入自动清。
- 缓存目录水位（TD-07）：`.data/media` / `.data/source` 不再无界增长——每 50 次写入异步扫描，超水位（默认 2GB / 512MB，`kami.config.json` 可调）按最旧淘汰到 80%。
- 上游层拆解（TD-01）：1257 行的 upstream.server.ts 按站点拆成 pixiv / fanbox / booru / media / dispatch 模块，导入方零改动；补 7 个固定样本映射测试，上游接口改版时破损点一目了然。
- Konachan 镜像兜底补盲区（TD-11）：被 Cloudflare 拦杀时返回的常是 200 + 挑战页 HTML，此前只有非 200 才切 .net 镜像，现在 HTML 形态也切。
- 工程脚本进类型检查（TD-05）：tsconfig 覆盖 scripts/，补齐 82 处注解并修掉 2 个真实类型问题。
- 测试恢复全量 glob（死工具链测试随平台退出删除），全绿。

### 安全（第一批）

- 数据接口全部上锁（修 12 号文档 SEC-01/02/07）：纸匣读写、热榜、会话写入、代理设置、登录中转、上游读取、搜图、图片代理此前对局域网完全敞开，现在统一过访问闸——开着应用账号时只认已登录会话；没开账号时（如 Docker 默认形态）只认启动时生成的「局域网配对令牌」，新设备首次打开贴一次令牌即完成配对（终端会打印令牌和配对链接，令牌存在 `.data/lan-token.json`，删掉重启即换新）。跨站脚本请求同时被 Fetch-Metadata 隔离挡在 403。
- 登录中转的轮询快照不再携带 Pixiv / FANBOX 会话明文（SEC-02）：280ms 的画面轮询全程无凭据，前端只在登录完成的那一刻单独取一次。
- 纸匣键名的作品 id 白名单去掉点号（SEC-10），彻底关掉 `..` 形式的目录上爬缝隙。

### 工程（第一批）

- 修复测试「假绿」：`npm test` 之前是手写文件清单，10 个测试文件（浏览历史、热榜存储/归档、Pixiv 搜索/主页、标签库等）从未被运行过；改为 glob 自动发现、全量执行（当前 241 个），并补上热榜存储的 Windows 句柄修复。
- 新增 GitHub Actions CI（typecheck + test + lint + build），对齐 Dockerfile 的 Node 22。
- 媒体层同 URL 并发只打一次上游（多卡片同图不再重复请求），无 Content-Length 的流式转发补上 48MB 累计上限。
- 顺手清掉 4 个存量 lint error；Next 的 instrumentation 钩子在 pnpm 布局下打不了 `node:` 依赖，配对令牌改为首次被访问闸读到时打印。

### 文档

- README 写明 `pnpm dev` / `build` / `start` / Docker 都走 Next，并补了技术栈、服务端缓存和 `.data` 落盘。
- README 去掉「技术」段，用法按跑起来 / 上手 / 日常 / 数据在哪儿重写；鸣谢加上 ZCode。

### 调整

- Docker 镜像改跑 Next standalone（`node server.js`，端口 8080）。compose 设 `HOSTNAME=0.0.0.0`；镜像里带 Chromium 给登录中转。
- 去掉 Vite / TanStack Start 退路。开发、构建、生产都只走 Next.js App Router。
- 浏览拼版不再卡在 1280px / 五列：窗口最大化、分辨率变高或浏览器缩小都会加列铺满；放大则减列。设置和详情仍自己限宽。
- 宽屏拼版行高还高于目标时继续往行里塞卡片，不再提前收成单卡留白。

### 新增

- 修详情页打开慢：配代理时上游请求从「每请求一个 curl 进程、全新 TLS 握手」改为 undici 持久连接池，实测 Pixiv 单请求从 1~6 秒降到预热后 0.2~0.4 秒，点进详情从 5.7 秒回到毫秒级。连接池连不上时自动回退 curl（连续失败熔断 10 分钟，避免双份超时）。
- 应用账号（设置 → 账号）：纸匣自己的邮箱 + 密码登录。登录后设置自动同步到本机服务端（`.data` 下的 JSON 快照），换浏览器 / 换设备登录同一账号即可恢复各图站 Cookie、Danbooru 凭据、词表、纸匣索引和浏览历史；设置变化自动推送，也可手动「同步 / 恢复」。强杀进程（关终端、断电）后账号不丢——注册、登录、同步时即时落盘。
- 修复打开非浏览页（队列、纸匣等）时偶发的「Missing queryFn」红屏：浏览列表的本地缓存恢复后，后台刷新只打当前挂载的键，其余键回到浏览页时再按新旧补刷（顺带修了旧列表回来不更新的问题）。localhost 与 127.0.0.1 是两个独立的源，只有真正用来浏览的那一侧才有这份缓存，所以错误只在那一侧出现。
- 设置 → 搜图 → Danbooru 账号：Danbooru 开了 Cloudflare 人机验证，匿名请求一律 403。填入用户名和 API key 后，榜单、详情和图片都会带凭据请求，按官方口径可免验证。
- Konachan 被 Cloudflare 拦杀期间自动改用 konachan.net 全年龄镜像兜底（周榜、月榜已恢复；日榜等镜像数据跟上）。墙撤掉后自动回到 konachan.com。
- 修复浏览页首屏的 hydration 警告：就是 Next 开发工具那个会挡点击的「1 Issue」红色气泡。设置从 localStorage 同步恢复，之前服务端默认值和浏览器对不上；现在水合完成前统一渲染骨架。
- 设置增加「备份」：导出 / 导入本机设置、账号、纸匣目录、词表和浏览历史。原图仍在文件夹和应用内目录，备份文件不打包像素。
- 纸匣封面：只在应用内库有像素时才请求 `/api/vault`；只在用户文件夹里的图不再 404。需要文件夹授权才能预览那些封面。
- 封面和浏览列表缓存在 Next 服务端（`.data/media`、`.data/source`）。日榜、图站、关注、推荐、FANBOX 都进列表缓存。刷新先画浏览器，再问 Next。换访问 IP 不用重新拉源站。
- 浏览榜单增加「刷新」：跳过浏览器和 Next 列表缓存，重新拉源站并覆盖本地缓存。
- 修复 FANBOX 切到 Pixiv（以及其它图源互切）时网格里会留下上一站卡片的问题。
- 浏览、详情和悬停预览里的 GIF / Pixiv 动图会自动播放。图站封面改用动图文件而不是静帧。
- 动图压缩包拉取带重试：代理偶发限流不再让卡片停在静帧。

## [0.8.56] — 2026-09-08

对应 [PR #99](https://github.com/Atsukiizumi/Kami-paperbox/pull/99)。

### 调整

- 默认 `pnpm dev` 改为 Next.js 15 App Router（端口仍是 8080，绑 `0.0.0.0`）。Vite 退路：`pnpm dev:vite`。
- 站内跳转改走 `kami-link`。浏览保活、详情上一页、纸匣、队列、搜图、热榜、登录 cookie、红心路径不变。
- 纸匣 / 媒体 / 代理 / 热榜 / 搜图 / 登录中转 / whoami 接到 App Router；登录 Cookie 写入走 `/api/sessions`。

### 新增

- 上游读写打本站 `/api/source`、`/api/social`。

## [0.8.55] — 2026-09-08

对应 [PR #98](https://github.com/Atsukiizumi/Kami-paperbox/pull/98)。

### 新增

- Yande / Konachan / Danbooru 增加日榜、周榜、月榜；Danbooru 另有近期热门（order:rank）。
- 图站日周月榜会记进本机库，侧栏「热榜」可按站、按日期回看或清理。Pixiv 用浏览页日期直接拉原站历史榜，不再另存。
- 浏览历史保留 90 天、不设条数上限，可按站点筛选。
- FANBOX 投稿里的附件在详情页可下，入队会连文件一起收。

### 调整

- 拼画右上横排页数和 GIF，分辨率在右下。
- 浏览页榜单日期固定在右侧，加载时不再跳动。
- 热榜页站点和日周月分行选择；纸匣作者改成下拉过滤，并同时读取浏览器库和本机目录。

## [0.8.54] — 2026-09-08

对应 [PR #97](https://github.com/Atsukiizumi/Kami-paperbox/pull/97)。

### 新增

- 图站标签数据库：按 general / copyright / character 等命名空间收录 Yande 系高频 tag，浏览时继续收词，设置里可补译。
- 设置改为左侧分类切页。

### 调整

- 搜图一次问 SauceNAO、ascii2d、IQDB，结果按引擎分组；被风控的那一组单独标明。
- 去掉 TinEye。SauceNAO API key 只在设置里填。

### 文档

- README 鸣谢 yande-re-chinese-patch、Yande.re、EhTagTranslation/Database、PixEz。

## [0.8.53] — 2026-09-08

对应 [PR #96](https://github.com/Atsukiizumi/Kami-paperbox/pull/96)。

### 调整

- 拼版会从后面抽长宽比合适的图填缝，竖图旁边不再空一大块。
- 纸匣改用同一套拼版。

## [0.8.52] — 2026-09-08

对应 [PR #95](https://github.com/Atsukiizumi/Kami-paperbox/pull/95)。

### 新增

- 详情页展示 Statistics：Id、Posted、Size、Source、Rating。图站来源可点开。

## [0.8.51] — 2026-09-03

对应 [PR #94](https://github.com/Atsukiizumi/Kami-paperbox/pull/94)。

### 新增

- 图站合集：粘贴 `yande.re/pool/show/…` 打开，可整包下载或收入纸匣。
- 单图详情显示所属合集，点击跳转。

### 调整

- 浏览改为每页 50 张，不再无限往下滚。

## [0.8.50] — 2026-09-02

对应 [PR #93](https://github.com/Atsukiizumi/Kami-paperbox/pull/93)。

### 调整

- 空态、折角、笺条、详情一条吸顶、悬停预览不再整屏压暗。
- 入队会飞一张纸到队列。骨架留空统一成 3:4。
- 画师页改无限滚动。新 X 横幅。

## [0.8.49] — 2026-09-02

对应 [PR #92](https://github.com/Atsukiizumi/Kami-paperbox/pull/92)。

### 调整

- 纸匣改为瀑布流竖列，封面保持原比例。悬停导出 / 移除不变。
- 换了分享预览和 X 横幅：暗案展开纸匣，标题 Kami Paperbox / 纸匣。

## [0.8.48] — 2026-09-02

对应 [PR #91](https://github.com/Atsukiizumi/Kami-paperbox/pull/91)。

### 调整

- 纸匣改回和浏览同一套按比例撑满的拼版。2 / 4 / 6 / 9 只改一行大概几张，不再切成方格。

## [0.8.47] — 2026-09-02

对应 [PR #90](https://github.com/Atsukiizumi/Kami-paperbox/pull/90)。

### 新增

- 图站 tag 英译中：导出/导入 JSON（`en` / `zh`），用户译文覆盖内置词表。搜索仍发英文。
- 纸匣拼版浏览：2 / 4 / 6 / 9。
- 原图优先留在指定文件夹，纸匣只记路径和 SHA-256；扫描可标出被替换的文件。

### 调整

- 下载和收入纸匣都只走队列，并显示类型、状态、进度。不再另存旁路。

## [0.8.46] — 2026-09-02

对应 [PR #89](https://github.com/Atsukiizumi/Kami-paperbox/pull/89)。

### 新增

- 历史浏览记下看过的作者（Pixiv 画师、FANBOX 创作者），和作品分开列。

### 文档

- README 补回 AI powered by Grok。

## [0.8.45] — 2026-09-02

对应 [PR #88](https://github.com/Atsukiizumi/Kami-paperbox/pull/88)。

### 调整

- 搜索栏空格拆成多标签（并且）。Pixiv、Yande、Konachan、Danbooru 都支持。FANBOX 仍只吃第一个词。

## [0.8.44] — 2026-09-02

对应 [PR #87](https://github.com/Atsukiizumi/Kami-paperbox/pull/87)。

### 调整

- 画师页作品改为从新到旧；最新一张标「最新」；Pixiv 置顶（pickup）单独一栏。

## [0.8.43] — 2026-09-01

对应 [PR #86](https://github.com/Atsukiizumi/Kami-paperbox/pull/86)。

### 文档

- README 改为「高速迭代中」，不再罗列功能。

## [0.8.42] — 2026-09-01

对应 [PR #85](https://github.com/Atsukiizumi/Kami-paperbox/pull/85)。

### 新增

- 历史浏览：打开过的作品记在侧栏「历史」，最多 200 条，再点能回去。

## [0.8.41] — 2026-09-01

对应 [PR #84](https://github.com/Atsukiizumi/Kami-paperbox/pull/84)。

### 修复

- 红心改为写入 Pixiv 收藏（站点上的♡）。之前只打了いいね，收藏列表和作品页的心都不会亮。

## [0.8.40] — 2026-09-01

对应 [PR #83](https://github.com/Atsukiizumi/Kami-paperbox/pull/83)。

### 新增

- 多图卡片可左右划前几页。
- 灯箱底部有分页条，点缩略图跳页。

### 调整

- 作品页操作条吸在「上一页」下面。
- 大图铺满内容区，标题和标签让到边上/底下。
- 从浏览点进作品不再拆掉浏览页，上一页回到原来的滚动位置。

## [0.8.39] — 2026-09-01

对应 [PR #82](https://github.com/Atsukiizumi/Kami-paperbox/pull/82)。

### 调整

- 作品 / 画师 / 创作者页的「上一页」「返回浏览」吸在顶栏下面，滚下去也能点。

## [0.8.38] — 2026-09-01

对应 [PR #81](https://github.com/Atsukiizumi/Kami-paperbox/pull/81)。

### 修复

- 作品页「下载」改为加入下载队列，不再偷偷当场存完。纸匣仍然立刻收藏；队列页能看到进度。

## [0.8.37] — 2026-09-01

对应 [PR #80](https://github.com/Atsukiizumi/Kami-paperbox/pull/80)。

### 文档

- 补 Pixiv 认证说明：网页 Cookie、App OAuth、开放平台三条线，纸匣只走网页会话。

## [0.8.36] — 2026-09-01

对应 [PR #79](https://github.com/Atsukiizumi/Kami-paperbox/pull/79)。

### 修复

- 详情页和卡片点红心立刻亮起，请求失败再收回。登录后预热 Pixiv CSRF，不再每次先扒一遍首页。

## [0.8.35] — 2026-09-01

对应 [PR #78](https://github.com/Atsukiizumi/Kami-paperbox/pull/78)。

### 调整

- 作品页操作收成一条纸质条：纸匣、下载、队列、收藏、红心、关注、搜来源、原站。灯箱里用同一套，略小一号。

## [0.8.34] — 2026-09-01

对应 [PR #77](https://github.com/Atsukiizumi/Kami-paperbox/pull/77)。

### 新增

- 封面操作条在纸匣旁加入队。已在队列再点会提示，不重复排。

### 调整

- 红心 / 纸匣 / 队列收成一条磨砂纸质胶囊，标题区加了一层纸边。

## [0.8.33] — 2026-09-01

对应 [PR #76](https://github.com/Atsukiizumi/Kami-paperbox/pull/76)。

### 调整

- 卡片标题旁不再放「加入队列」和「原始链接」。入队和打开原站仍在右键菜单。

## [0.8.32] — 2026-09-01

对应 [PR #75](https://github.com/Atsukiizumi/Kami-paperbox/pull/75)。

### 修复

- 卡片悬停预览改为停约半秒再弹出，红心和纸匣来得及点。

## [0.8.31] — 2026-09-01

对应 [PR #74](https://github.com/Atsukiizumi/Kami-paperbox/pull/74)。关 [#73](https://github.com/Atsukiizumi/Kami-paperbox/issues/73)。

### 修复

- 封面流被掐掉时正常结束，不再被 h3 打成未处理 500 AbortError。开发服也滤掉这类终端噪音。

## [0.8.30] — 2026-09-01

对应 [PR #72](https://github.com/Atsukiizumi/Kami-paperbox/pull/72)。

### 修复

- 找不到的地址显示「没有这一页」，不再丢 TanStack 默认英文 Not Found。
- 把客户端断开（Abort / ECONNRESET）认成取消，不当业务 500。滚动切页时控制台仍可能打一行，那是传输中断。

## [0.8.29] — 2026-09-01

对应 [PR #71](https://github.com/Atsukiizumi/Kami-paperbox/pull/71)。

### 新增

- Pixiv 搜索条件：检索范围、作品类型、年龄、投稿时间、收藏数、横竖图、最新/最旧/热门。对照官网那层。

### 修复

- 搜索框失焦后联想会收起。
- 点候选项只搜索，不再丢进去不掉的标签列。快捷标签要自己保存，点 × 或再点一次可取消。

## [0.8.28] — 2026-09-01

对应 [PR #69](https://github.com/Atsukiizumi/Kami-paperbox/pull/69)。

### 修复

- Issue 模板名改为「问题报告」「功能提议」（GitHub 要求至少 3 个字符）。顺手删掉设置页自动生成的英文默认模板。

## [0.8.27] — 2026-09-01

对应 [PR #68](https://github.com/Atsukiizumi/Kami-paperbox/pull/68)。

### 修复

- Issue 表单改成和 stevemao/github-issue-templates 一样的写法（无 `type:`，文件名 `BUG-REPORT.yml` / `FEATURE-REQUEST.yml`）。带 Issue Type 的表单不会出现在 Templates and forms 列表里。

## [0.8.26] — 2026-09-01

对应 [PR #67](https://github.com/Atsukiizumi/Kami-paperbox/pull/67)。

### 修复

- Issue 模板补上 GitHub 的 `type: Bug` / `type: Feature`。新版创建页按类型筛模板，缺这个选择器就是空的。

## [0.8.25] — 2026-09-01

对应 [PR #66](https://github.com/Atsukiizumi/Kami-paperbox/pull/66)。

### 修复

- Issue 模板改成 Markdown。YAML 表单没通过 GitHub 校验时选择器里只剩空白 issue。

## [0.8.24] — 2026-09-01

对应 [PR #65](https://github.com/Atsukiizumi/Kami-paperbox/pull/65)。

### 改进

- GitHub 问题分「问题 / 功能」两套模板；PR 也有模板。问题按复现步骤写，功能随便提。

## [0.8.23] — 2026-09-01

对应 [PR #63](https://github.com/Atsukiizumi/Kami-paperbox/pull/63)。

### 修复

- 点 R-18 日/周会去拉 Pixiv 远端榜单。会话写在 Cookie 头里也能认出；账号有资料但会话失效会提示重新登录，不再假装已登录却拦请求。

## [0.8.22] — 2026-09-01

对应 [PR #62](https://github.com/Atsukiizumi/Kami-paperbox/pull/62)。

### 改进

- 控流可在 `kami.config.json` 的 `throttle` 里改：封面并发、429 重试、搜图间隔。保存即生效。

## [0.8.21] — 2026-09-01

对应 [PR #61](https://github.com/Atsukiizumi/Kami-paperbox/pull/61)。

### 修复

- 封面打空：pximg 并发闸、429 重试，失败的格子会再拉几次，不再一张失败就留黑块。

## [0.8.20] — 2026-09-01

对应 [PR #60](https://github.com/Atsukiizumi/Kami-paperbox/pull/60)。

### 改进

- 浏览页把榜单 / 推荐写入本地缓存。刷新先上屏历史数据，超过 30 分钟才后台更新。

## [0.8.19] — 2026-09-01

对应 [PR #59](https://github.com/Atsukiizumi/Kami-paperbox/pull/59)。

### 改进

- 封面加载完就预热放大图；悬停再点一次内存和 HTTP 缓存，弹层不再扫光。

## [0.8.18] — 2026-09-01

对应 [PR #58](https://github.com/Atsukiizumi/Kami-paperbox/pull/58)。

### 改进

- 悬停预览从卡片中心放大，封面先隐掉，并用 master1200 / sample，不再旁边叠一张糊图。

## [0.8.17] — 2026-09-01

对应 [PR #57](https://github.com/Atsukiizumi/Kami-paperbox/pull/57)。

### 改进

- 浏览搜索加标签联想：Pixiv / 图站走源站补全，已保存的标签也会出现。方向键选择。

## [0.8.16] — 2026-09-01

对应 [PR #56](https://github.com/Atsukiizumi/Kami-paperbox/pull/56)。

### 改进

- FLIP 中断不再闪回：commit 当前矩阵当新的 First，按时长比例收回。

## [0.8.15] — 2026-09-01

对应 [PR #55](https://github.com/Atsukiizumi/Kami-paperbox/pull/55)。

### 改进

- 悬停预览改成 FLIP：只动 transform / opacity，不再每帧改宽高。轻漂放在内层。

## [0.8.14] — 2026-09-01

对应 [PR #54](https://github.com/Atsukiizumi/Kami-paperbox/pull/54)。

### 改进

- 悬停预览从封面浮到旁边，停住后轻轻漂。卡片抬起也顺一些。

## [0.8.13] — 2026-09-01

对应 [PR #53](https://github.com/Atsukiizumi/Kami-paperbox/pull/53)。

### 改进

- 浏览榜单、搜索、FANBOX 改为往下加页。鼠标停在封面上会在旁边放大整张图。

## [0.8.12] — 2026-09-01

对应 [PR #52](https://github.com/Atsukiizumi/Kami-paperbox/pull/52)。

### 改进

- 去掉键盘快捷键。卡片右键可打开、保存、红心、入队、复制链接。悬停稍停再预取，避免扫过就打请求。

## [0.8.11] — 2026-09-01

对应 [PR #51](https://github.com/Atsukiizumi/Kami-paperbox/pull/51)。

### 改进

- `/` 聚焦搜索，Esc 从详情返回。悬停卡片会预取作品。把图拖进窗口即可搜图。队列项可点进作品。

## [0.8.10] — 2026-09-01

对应 [PR #50](https://github.com/Atsukiizumi/Kami-paperbox/pull/50)。

### 改进

- 浏览卡片上的作者和标签可点：Pixiv / FANBOX 进主页，标签拿去搜索。

## [0.8.9] — 2026-09-01

对应 [PR #49](https://github.com/Atsukiizumi/Kami-paperbox/pull/49)。

### 改进

- 画师 / 创作者头像铺满圆形。简介过长先收成三行，可点开。

## [0.8.8] — 2026-09-01

对应 [PR #48](https://github.com/Atsukiizumi/Kami-paperbox/pull/48)。

### 改进

- 详情页去掉作品网址和标签说明。上一页走浏览器历史（可连点），返回浏览回到首页。

## [0.8.7] — 2026-09-01

对应 [PR #47](https://github.com/Atsukiizumi/Kami-paperbox/pull/47)。

### 修复

- 加载占位改成整齐的等宽格子，不再用乱长宽比去拼版。

## [0.8.6] — 2026-09-01

对应 [PR #46](https://github.com/Atsukiizumi/Kami-paperbox/pull/46)。

### 改进

- 浏览网格重排会滑过去，点进作品封面会衔接到详情，红心和收入有回弹。切主题、滚动条、灯箱也顺了一些。

## [0.8.5] — 2026-09-01

对应 [PR #45](https://github.com/Atsukiizumi/Kami-paperbox/pull/45)。

### 修复

- 单独成行的横图会重新铺满这一行，不再被收成小条。

## [0.8.4] — 2026-09-01

对应 [PR #44](https://github.com/Atsukiizumi/Kami-paperbox/pull/44)。

### 修复

- 竖图卡片不再被拉成整行，封面也不会只剩左边一条。

## [0.8.3] — 2026-09-01

对应 [PR #43](https://github.com/Atsukiizumi/Kami-paperbox/pull/43)。

### 改进

- 搜图会先缩小再传，并限制各引擎的请求间隔，降低人机验证和控流。
- 可填 SauceNAO API key；被拦时一键改用 IQDB。

## [0.8.2] — 2026-09-01

对应 [PR #42](https://github.com/Atsukiizumi/Kami-paperbox/pull/42)。

### 改进

- 浏览卡片和作品页显示图片分辨率（例如 1920×1080）。

## [0.8.1] — 2026-09-01

对应 [PR #41](https://github.com/Atsukiizumi/Kami-paperbox/pull/41)。

### 修复

- 首次向导不再在服务端读 localStorage 水合状态，打开应用不会 500。

## [0.8.0] — 2026-09-01

对应 [PR #40](https://github.com/Atsukiizumi/Kami-paperbox/pull/40)。

### 改进

- 浏览和作品页能看出已经收入纸匣。
- 第一次打开有登录向导：Pixiv → FANBOX → 文件夹。
- 纸匣页改成和浏览同一套拼版，作者做成可点的筛选条，点卡片进作品页。

## [0.7.20] — 2026-09-01

对应 [PR #39](https://github.com/Atsukiizumi/Kami-paperbox/pull/39)。

### 修复

- 第 9 个账号不再冲掉当前登录。
- 队列入队竞态、失败重试、下载进度。
- FANBOX 与 Pixiv 会话分开带 Cookie；登录后会写回 HttpOnly。
- CSRF 过期会清缓存再试；纸匣缩略图 Object URL 会释放。
- 榜单最后一页不再空翻。

## [0.7.19] — 2026-09-01

对应 [PR #38](https://github.com/Atsukiizumi/Kami-paperbox/pull/38)。

### 修复

- 刷新后卡在「进行中」的下载会重新排队并继续。
- 浏览页红心会写回列表缓存。
- HTML 实体解码、Cookie 长度上限、whoami 失败不再冲掉已有资料。

## [0.7.18] — 2026-09-01

对应 [PR #37](https://github.com/Atsukiizumi/Kami-paperbox/pull/37)。

### 修复

- 浏览页红心：Pixiv 作品页已改成 Next.js，CSRF 从 `__NEXT_DATA__.api.token` 读取。

## [0.7.17] — 2026-09-01

对应 [PR #36](https://github.com/Atsukiizumi/Kami-paperbox/pull/36)。

### 修复

- 动效不再被 `prefers-reduced-motion` 整页打成 0ms；切页、悬停、榜单滑块都能看见。

## [0.7.16] — 2026-09-01

对应 [PR #35](https://github.com/Atsukiizumi/Kami-paperbox/pull/35)。

### 改进

- 页面进场带位移和虚化，卡片悬停抬起，封面从模糊落到清晰。
- 搜图引擎改用 Tabs，侧栏用 ScrollArea。

## [0.7.15] — 2026-09-01

对应 [PR #34](https://github.com/Atsukiizumi/Kami-paperbox/pull/34)。

### 改进

- 搜图增加 ascii2d（色合 + 特征）。
- SauceNAO 不再在安全模式里 hide=3，避免把 90%+ 的真匹配藏掉只剩无关低分。

## [0.7.14] — 2026-09-01

对应 [PR #33](https://github.com/Atsukiizumi/Kami-paperbox/pull/33)。

### 改进

- 从作品页返回浏览不再重新拉列表：缓存半小时，滚动位置保留，已看过的封面直接亮。

## [0.7.13] — 2026-09-01

对应 [PR #32](https://github.com/Atsukiizumi/Kami-paperbox/pull/32)。

### 修复

- 滚走或关掉作品页时，图片代理被浏览器取消不再刷成 500 AbortError。

## [0.7.12] — 2026-09-01

对应 [PR #31](https://github.com/Atsukiizumi/Kami-paperbox/pull/31)。

### 修复

- 作品页图片按原比例完整显示，不再被封面用的裁切铺满切掉。

## [0.7.11] — 2026-09-01

对应 [PR #30](https://github.com/Atsukiizumi/Kami-paperbox/pull/30)。

### 改进

- 顶栏图源改用 Radix Select，只显示站点名，不再塞用户头像和名字。
- 头像改用 Radix Avatar；封面代理不再把宽度撑满顶栏。

## [0.7.10] — 2026-08-31

对应 [PR #29](https://github.com/Atsukiizumi/Kami-paperbox/pull/29)。

### 改进

- 封面改为到一张亮一张：卡片先用比例占位，进入视口附近才请求，不再等攒够一批才出图。

## [0.7.9] — 2026-08-31

对应 [PR #28](https://github.com/Atsukiizumi/Kami-paperbox/pull/28)。

### 改进

- 浏览网格等待源站和封面时代替空白灰块：骨架扫光 + 「正在加载作品」。封面没到之前卡片里也会扫。

## [0.7.8] — 2026-08-31

对应 [PR #27](https://github.com/Atsukiizumi/Kami-paperbox/pull/27)。

### 改进

- 用 Radix / shadcn 风格组件收齐界面：浏览榜单用 ToggleGroup，详情用面包屑，设置用 Card，队列用 Progress，侧栏收起有 Tooltip，错误用 Alert。

## [0.7.7] — 2026-08-31

对应 [PR #26](https://github.com/Atsukiizumi/Kami-paperbox/pull/26)。

### 改进

- 作品、画师、创作者页顶部增加「返回浏览」。

## [0.7.6] — 2026-08-31

对应 [PR #25](https://github.com/Atsukiizumi/Kami-paperbox/pull/25)。

### 改进

- 封面图代理改为流式转发，并缓存一周，翻页不再每张都重新去源站拉。
- 首屏 8 张封面优先加载；作品页只把第一张当急件。
- 翻页保留上一页网格，不再闪骨架屏。
- 字体只拉 Newsreader + Noto Sans SC 两套，并预连接 Google Fonts。

## [0.7.5] — 2026-08-31

对应 [PR #24](https://github.com/Atsukiizumi/Kami-paperbox/pull/24)。

### 新增

- 各站标签规则分开：Pixiv 点标签走精确匹配，搜索框空格表示同时包含；Yande / Konachan / Danbooru 空格是并且，标签里的空格写成下划线；FANBOX 一次一个标签。
- 每个站点可保存快捷标签（作品页星星，或浏览页「保存当前搜索」），点一下就按该站规则搜索。

## [0.7.4] — 2026-08-31

对应 [PR #23](https://github.com/Atsukiizumi/Kami-paperbox/pull/23)。

### 修复

- 作品页会显示标签。以前 Pixiv 详情把 `{ tags: { tags: [...] } }` 解错了，界面上一张 tag 都没有。点标签会回到浏览页搜索该词。

## [0.7.3] — 2026-08-31

对应 [PR #22](https://github.com/Atsukiizumi/Kami-paperbox/pull/22)。

### 新增

- 浏览卡片封面可以直接保存进纸匣；Pixiv 卡片还可以点红心，不必先打开作品页。

## [0.7.2] — 2026-08-31

对应 [PR #21](https://github.com/Atsukiizumi/Kami-paperbox/pull/21)。

### 修复

- 点收藏 / 红心 / 关注时，不再因为 Pixiv 首页 CSRF 格式变了就误报「无法取得凭证，请重新登录」。已登录账号会从 `meta-global-data` 等位置解析 token，并在作品页、设置页兜底。

## [0.7.1] — 2026-08-31

对应 [PR #20](https://github.com/Atsukiizumi/Kami-paperbox/pull/20)。

### 文档

- 增加 [docs/storage.md](docs/storage.md)：纸匣三层存储、为什么原图是文件、为什么用 SQLite 而不是图数据库、写入顺序和 `/api/vault`。

## [0.7.0] — 2026-08-31

对应 [PR #19](https://github.com/Atsukiizumi/Kami-paperbox/pull/19)。

### 新增

- 本机 Node 纸匣目录：元数据用 SQLite（Node 22 自带 `node:sqlite`），原图写在 `.data/vault/files`。收入纸匣会同时推到服务器；纸匣页优先读这份目录。浏览器 IndexedDB 仍作预览缓存，Node 写不了盘时自动回退。

## [0.6.5] — 2026-08-31

对应 [PR #18](https://github.com/Atsukiizumi/Kami-paperbox/pull/18)。

### 改进

- 拼版加了最小卡片宽度，竖图不会再挤成一条，标题可以显示两行。
- 纸匣做成可查询的目录：按标题、作者、标签、路径搜索，并记下写入文件夹时的相对路径。元数据仍在 IndexedDB（适合存图），不是 SQLite。
- 核心模块补上「作用 / 用法 / 为什么」注释，约定见 [docs/comments.md](docs/comments.md)。

## [0.6.4] — 2026-08-31

对应 [PR #17](https://github.com/Atsukiizumi/Kami-paperbox/pull/17)。

### 改进

- 浏览拼版改成按行撑满：同一行等高，横图变宽、竖图变窄，中间不再留出大块空位。
- FANBOX 动态 / 已支持 / 创作者可以「加载更多」；封面、正文图片按投稿顺序读取；没有封面的投稿显示摘要而不是空盒子。

## [0.6.3] — 2026-08-31

对应 [PR #16](https://github.com/Atsukiizumi/Kami-paperbox/pull/16)。

### 文档

- 增加 [docs/reverse-engineering.md](docs/reverse-engineering.md)：从 DevTools 点击、无头 Chrome 拦 XHR、拆前端 JS、curl 复打和消融请求头，到 Cookie / FANBOX 回转，按步骤写清。
- 增加 `node scripts/sniff-xhr.mjs <url>`，在没有图形界面时打印页面打出的接口。

## [0.6.2] — 2026-08-31

对应 [PR #15](https://github.com/Atsukiizumi/Kami-paperbox/pull/15)。

### 文档

- 增加 [docs/upstream.md](docs/upstream.md)：怎么用浏览器 Network / Cookie 面板读 Pixiv、FANBOX 的接口，以及访客 Cookie、FANBOX `/auth/start` 回转这些踩过的坑。

## [0.6.1] — 2026-08-31

对应 [PR #14](https://github.com/Atsukiizumi/Kami-paperbox/pull/14)。

### 修复

- FANBOX 登录改为官方地址：Pixiv 选账号后回转 `www.fanbox.cc/auth/start`，再收回 `FANBOXSESSID`。之前只打开 FANBOX 首页，会拿到访客 Cookie，请求 401。
- 已经登过 Pixiv 的会话会同时当作 FANBOX 会话使用。访客 `FANBOXSESSID` 不再保存。

## [0.6.0] — 2026-08-31

对应 [PR #13](https://github.com/Atsukiizumi/Kami-paperbox/pull/13)。

### 变更

- 「登录 Pixiv / FANBOX」不再往本机桌面弹一个你看不见的 Chrome。后端打开官方登录页，把画面中转到设置里的窗口，点、打字都在这个窗口里完成，登进去再把 Cookie 收回来。
- 网页预览、Docker、没有桌面的环境也能登录。仍然可以用剪贴板粘贴 PHPSESSID、Cookie 导出 JSON 或 cookies.txt。

## [0.5.1] — 2026-08-31

对应 [PR #12](https://github.com/Atsukiizumi/Kami-paperbox/pull/12)。

### 修复

- 「浏览器登录」不再把登录页一打开就发的访客 `PHPSESSID` 当成已登录。那种 Cookie 会立刻关掉窗口、没有头像和用户名，随后 Pixiv 请求 401/403。现在会等到真正登进去（`用户ID_令牌`），并从官方页面读资料。
- 已经存下来的访客 Cookie 会在下次打开时丢掉。请求也不会再带上无效会话。

## [0.5.0] — 2026-08-31

对应 [PR #11](https://github.com/Atsukiizumi/Kami-paperbox/pull/11)。

### 新增

- 设置里可以选下载目标文件夹（本机 Chrome / Edge）。收入纸匣仍先存在浏览器里，并可同时按规则写入该文件夹。
- 分类规则：扁平、作者、日期、日期+时间、作者+日期、站点+作者，或自己写 `{author}` `{date}` `{time}` `{title}` 等占位符。日期按保存当时计算。
- 浏览器会申请持久化存储，减少纸匣被自动清掉的机会。


## [0.4.3] — 2026-08-31

对应 [PR #10](https://github.com/Atsukiizumi/Kami-paperbox/pull/10)。

### 变更

- 浏览拼版改成流水排布：竖图填进最短的一列，横图仍跨列放大，不再在格子之间留下大块空白。


## [0.4.2] — 2026-08-31

对应 [PR #9](https://github.com/Atsukiizumi/Kami-paperbox/pull/9)。

### 变更

- 横图不再挤在单列里显得很小。普通横图会跨两列放大，特别宽的全景会铺满一整行。竖图仍按原比例拼在格子里。


## [0.4.1] — 2026-08-31

对应 [PR #8](https://github.com/Atsukiizumi/Kami-paperbox/pull/8)。

### 新增

- 换页、顶栏、侧栏和卡片会轻轻入场；导航指示条会滑过去。主题切换时配色会过渡。缩略图载入后淡入。加载骨架改成扫光。

## [0.4.0] — 2026-08-31

对应 [PR #7](https://github.com/Atsukiizumi/Kami-paperbox/pull/7)。

### 新增

- 设置和顶栏可以切换外观：浅色、深色，或跟随系统。
- 内置五套纸匣主题，每套都有深浅配色：和纸、青墨、朱砂、松烟、苔色。默认仍是和纸深色。

## [0.3.3] — 2026-08-31

对应 [PR #6](https://github.com/Atsukiizumi/Kami-paperbox/pull/6)。

### 变更

- 浏览、画师、创作者和相关作品改成按原图比例的拼版，不再统一裁成 3:4。特别横的或特别竖的会收在一个范围内。没有尺寸信息的卡片（多数 FANBOX）仍用 3:4。

## [0.3.2] — 2026-08-31

对应 [PR #5](https://github.com/Atsukiizumi/Kami-paperbox/pull/5)。

### 修复

- 开发模式下脚本会因为浏览器里 `new AsyncLocalStorage()` 直接崩掉，点任何按钮都没反应。不再把 `@tanstack/react-start` 预打包进前端。

## [0.3.1] — 2026-08-31

对应 [PR #4](https://github.com/Atsukiizumi/Kami-paperbox/pull/4)。

### 新增

- 浏览卡片、作品页、大图预览和纸匣都可以跳转源站「原始链接」。

### 修复

- 设置里保存代理以前只写到隐藏的 `.data/proxy.json`，打开 `kami.config.json` 会以为没存上。现在会同时写入 `kami.config.json`，立刻设置 `KAMI_PROXY`，Docker 数据卷会保留 `.data`。

### 变更

- `.gitignore` 忽略 `pnpm-lock.yaml` 和 `src/routeTree.gen.ts`（本地 `pnpm i` / `pnpm dev` 会再生成），并从版本库取消跟踪。

## [0.3.0] — 2026-08-31

### 新增

- 本更新日志，以及 README 入口。

### 变更

- 采用 [MIT License](LICENSE)。`package.json` 标注 `"license": "MIT"`。
- README 去掉法律声明和数据安全长文，只保留「本项目仅供学习交流」。

### 修复

- 点「浏览器登录 Pixiv / FANBOX」时，Vite `AbortError` 会把刚打开的 Chrome / Edge **立刻关掉**，看起来像没弹窗。登录窗口现在作为后台任务运行，和网页请求脱钩；设置页轮询状态，AbortError 不再整页刷新。
- 找不到窗口时看任务栏。设置里可以「取消弹窗」。终端成功时会打印 `[kami] 已打开登录窗口: …`。
- `puppeteer-core` 不再打进 Vite SSR 包，减少登录启动失败。

## [0.2.0] — 2026-08-31

对应 [PR #1](https://github.com/Atsukiizumi/Kami-paperbox/pull/1)、[PR #2](https://github.com/Atsukiizumi/Kami-paperbox/pull/2)。

### 新增

- 设置里「浏览器登录 Pixiv / FANBOX」：拉起本机 Chrome / Edge 打开官方登录页，抓取 `PHPSESSID` / `FANBOXSESSID`。手贴 Cookie 仍可用。Docker 无图形界面时请手贴。
- `/api/login-browser`、`/api/whoami`。
- Pixiv 与 FANBOX 用户名、头像分开保存，顶栏账号切换、图源切换、设置页都会显示。
- 依赖 `puppeteer-core`。找不到浏览器时可设 `KAMI_CHROME`。

## [0.1.0] — 2026-08-31

仓库首个公开快照。

### 新增

- 五个图源，顶栏一次只看一个站，每个站都能搜：Pixiv、pixiv FANBOX、Yande（yande.re）、Konachan、Danbooru。
- Pixiv 公开榜；登录后「为你推荐 / 关注」。FANBOX 公开创作者；登录后动态和已支持。图站最新 / 热门。
- 作品大图：缩放、拖动、键盘翻页。保存进纸匣、下载到磁盘。Pixiv 收藏（带 tag）、红心、关注；FANBOX 点赞、关注。动图播放并合成 GIF。
- 搜图：上传 / 拖入 / 粘贴本地图。默认 [SauceNAO](https://saucenao.com/)，可切 [IQDB](https://iqdb.org/)、[TinEye](https://tineye.com/)。
- 五个站都会带回 tag。
- 本地纸匣（IndexedDB）和下载队列。
- 多账号保存 Pixiv / FANBOX Cookie，顶栏切换。
- HTTP / SOCKS5 代理（设置、`kami.config.json`、`KAMI_PROXY`）。
- R-18 开关（默认关）。Pixiv AI 作画标记和过滤。
- Docker 与 `pnpm` 本地开发。监听地址写在 `kami.config.json`（默认 `0.0.0.0:8080`）。
- 可装成 PWA。
