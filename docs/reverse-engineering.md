# 上游逆向实操手册

这份写的是 **具体怎么动手**：点哪里、敲哪条命令、看到什么算成功。接口清单（纸匣已经在用的 URL）在 [upstream.md](upstream.md)。

纸匣不接官方开放平台。所谓「找 API」，就是让官方网页自己把 XHR 打出来，记下来，原样复打。不是破解、不是撞登录、不是绕过付费。密码只打在官方页上。

没有图形界面也能做。本机 Chrome 用 DevTools；这边这种纯 CLI 环境用无头 Chrome 拦请求，效果和 Network 面板是同一件事。

---

## 0. 一次完整循环（先记住这张图）

```text
① 在官方站点做一次你关心的操作
        ↓
② 把这次操作触发的 XHR/fetch 全部记下来
        ↓
③ 丢掉广告、统计、图片，留下 JSON 接口
        ↓
④ 用 curl 最小请求头复打，确认 200 + JSON
        ↓
⑤ 一次去掉一个头，看谁是必需的（Referer / Origin / Cookie / x-userid）
        ↓
⑥ 对着 JSON 画字段 → 纸匣的 WorkCard / WorkDetail
        ↓
⑦ 写进 src/lib/upstream.server.ts（或 social.server.ts），补解析测试
```

判断一条请求「是不是接口」：

| 留下 | 丢掉 |
| --- | --- |
| 路径含 `/ajax/`、`api.fanbox.cc`、`format=json`、`/post.json` | `google-analytics`、`doubleclick`、`ads-pixiv`、`prebid` |
| `content-type` 是 `application/json` | `.js` / `.css` / 字体 / 广告图 |
| 响应顶层有 `body` 或 `contents` 或 `posts` | `i.pximg.net` 图片本身（那是媒体，不是 API） |

---

## 1. 准备

### 1.1 本机有桌面时

- Chrome 或 Edge。**不要无痕**：无痕没有你的登录 Cookie。
- 先在官方站登好自己的号。
- 会用开发者工具即可，不必装插件。可选：Cookie-Editor（导出 JSON 方便粘到纸匣）。

### 1.2 纯 CLI / 无头环境（纸匣开发机就是这种）

需要：

- Node 22+
- 项目里的 `puppeteer-core`（`pnpm i` 之后就有）
- 一台 Chrome：本机 `google-chrome`，或 Playwright 的 `chrome-headless-shell`，或环境变量 `KAMI_CHROME`

后面「方法 B」的脚本就是给这种环境用的。

### 1.3 通用请求头（后面 curl 都带这些）

```text
User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36
```

Pixiv 再加：

```text
Referer: https://www.pixiv.net/
Cookie: PHPSESSID={用户ID}_{令牌}
x-userid: {用户ID}
```

FANBOX 再加：

```text
Origin: https://www.fanbox.cc
Referer: https://www.fanbox.cc/
Cookie: FANBOXSESSID={用户ID}_{令牌}; PHPSESSID={同一份}
```

已登录的会话值必须长成 `12345678_后面一串字母数字`。没有下划线的是访客 Cookie，后面步骤会专门辨认。

---

## 2. 方法 A：本机 Chrome DevTools（有 GUI 时）

这是最直观的一条路。无头环境的人可以跳到方法 B，但建议至少读一遍，知道「拦到的是什么」。

### 2.1 打开面板

1. 用 **已经登录** 的 Chrome 打开 https://www.pixiv.net/ranking.php?mode=daily
2. 键盘：
   - Windows / Linux：`F12` 或 `Ctrl+Shift+I`
   - macOS：`Cmd+Option+I`
3. 点顶部 **Network**（网络）。如果没有这一栏，点面板右上 `»` 展开。
4. 勾选 **Fetch/XHR**。Disable cache 建议勾上，避免看到磁盘缓存而不是真实请求。
5. 点面板里的 🚫 **Clear**，把旧记录清掉。

### 2.2 触发一次操作

只做 **一件事**，否则记录会混。例如：

| 你想找的接口 | 你在页面上做的事 |
| --- | --- |
| 日榜 | 打开 / 刷新 ranking.php?mode=daily |
| 搜索 | 顶栏搜一个词，等结果出来 |
| 作品详情 | 点进一张图，等大图出来 |
| 红心 | 在作品页点一次红心 |
| FANBOX 动态 | 打开 https://www.fanbox.cc 登录后的首页动态 |

每做一件，Network 里会多出若干行。

### 2.3 在列表里认出接口

Name 一列常见长这样：

```text
illust/148997860?lang=zh
pages?lang=zh
ranking.php?mode=daily&content=illust&p=1&format=json
user.info
post.listHome?limit=10
```

点其中一行，右侧有四个子页：

1. **Headers**
   - General → Request URL、Request Method、Status Code
   - Request Headers → `cookie` / `referer` / `origin` / `x-userid` / `x-csrf-token`
   - Query String Parameters
2. **Payload**（POST 才有）→ 表单或 JSON 体
3. **Preview / Response** → 是不是 JSON。Pixiv 几乎都是 `{ "error": false, "body": {…} }`；老榜单是 `{ "contents": […], "next": 2 }`
4. **Initiator** → 哪个 JS 打的（有时能跳进 bundle）

把 **Request URL 整段**、**方法**、**三个关键头**、**响应第一个对象的字段名** 抄到笔记里。

### 2.4 Copy as cURL（为方法 D 做准备）

1. 在该行上右键
2. Copy → **Copy as cURL**（Windows 有时显示 Copy as cURL (bash)）
3. 贴到文本编辑器。浏览器会带几十个头，先不要全用。典型可以立刻删掉的：

```text
sec-ch-ua
sec-ch-ua-mobile
sec-fetch-dest
sec-fetch-mode
sec-fetch-site
priority
```

留下：`url`、`-H 'user-agent:…'`、`-H 'referer:…'`、`-H 'origin:…'`、`-H 'cookie:…'`、`-H 'x-userid:…'`。

4. 终端跑一遍，看 HTTP 状态和是不是 JSON。通了再写代码。

### 2.5 导出 HAR（可选，整页存档）

Network 面板空白处右键 → **Save all as HAR with content**。HAR 是 JSON，可以用脚本筛：

```bash
python3 - <<'PY'
import json,sys
har=json.load(open("pixiv.har",encoding="utf-8"))
for e in har["log"]["entries"]:
    req=e["request"]; res=e["response"]
    u=req["url"]
    mime=(res.get("content") or {}).get("mimeType") or ""
    if "ajax" in u or "fanbox" in u or "format=json" in u:
        print(res.get("status"), req["method"], u[:140], mime)
PY
```

---

## 3. 方法 B：无头 Chrome 拦 XHR（无 GUI 时）

和 Network 面板等价：浏览器照常跑页面，我们在进程里监听每个请求。

仓库里有脚本 [`scripts/sniff-xhr.mjs`](../scripts/sniff-xhr.mjs)。

### 3.1 跑起来

在纸匣项目根目录：

```bash
pnpm i    # 已装过可跳过
node scripts/sniff-xhr.mjs "https://www.pixiv.net/ranking.php?mode=daily&content=illust"
```

可选环境变量：

| 变量 | 含义 |
| --- | --- |
| `KAMI_CHROME` | Chrome 可执行文件路径 |
| `SNIFF_WAIT_MS` | 打开页面后再等多少毫秒（默认 4000，给 XHR 时间） |
| `SNIFF_COOKIE` | 可选，形如 `PHPSESSID=12345678_xxx`，用来看登录态接口 |

只打印「像接口」的请求：xhr / fetch，或 URL 里带 `ajax`、`api.fanbox`、`format=json`、`ranking.php`。广告域名默认丢掉。

成功时长这样（节选）：

```text
200 GET  https://www.pixiv.net/ranking.php?mode=daily&content=illust
…（以及页面里其它 ajax）
```

日榜的数据接口常常 **不是** 页面 HTML 自己，而是同一个路径加 `format=json`。脚本如果只看到 document 200，下一步用方法 D 对这个 URL 加 `format=json` 复打——这就是当年找到榜单 JSON 的方式。

### 3.2 自己写监听（理解原理）

核心就三行：

```js
page.on("request", (req) => {
  const t = req.resourceType(); // document / xhr / fetch / script / image
  const u = req.url();
  if (t === "xhr" || t === "fetch") console.log(req.method(), u);
});
await page.goto(url, { waitUntil: "domcontentloaded" });
```

`resourceType()` 对应 DevTools 里 Type 列。登录态接口要先 `setCookie`，或启动时带 `userDataDir` 指向已经登过的配置。纸匣登录中转用的是临时目录 + 你在画面里现登，然后 `Network.getAllCookies`。

### 3.3 把响应体也拿出来

只看 URL 不够时：

```js
page.on("response", async (res) => {
  const ct = res.headers()["content-type"] || "";
  if (!ct.includes("json")) return;
  const text = await res.text();
  console.log(res.status(), res.url(), text.slice(0, 200));
});
```

注意：很大的 JSON 不要整份打到终端。先 `Object.keys(JSON.parse(text))`。

---

## 4. 方法 C：拆前端 JS，搜路径字符串

页面用的 URL 经常 **明文写在打包文件里**。

1. 打开官方页，DevTools → Network → JS，或查看源代码里的 `<script src="https://s.pximg.net/…/chunks/pages/ranking.php-….js">`
2. 把该 `.js` 下下来
3. 搜 `/ajax/`、`api.fanbox.cc`、`format=json`、`illusts/like`

CLI：

```bash
curl -sS -o /tmp/page.html -A "Mozilla/5.0" "https://www.pixiv.net/ranking.php?mode=daily"
grep -oE 'https://[^"]+\.js' /tmp/page.html | head

# 下某一个 chunk 再搜
curl -sS -o /tmp/app.js "https://s.pximg.net/…….js"
python3 - <<'PY'
import re
s=open("/tmp/app.js",encoding="utf-8",errors="ignore").read()
for u in sorted(set(re.findall(r'["\'](/ajax/[^"\']+)["\']', s))):
    print(u)
PY
```

搜到的是 **模板**，例如 `` `/ajax/illust/${id}` ``。再用方法 D 填一个真实 id 打一次。

FANBOX 前端会提到 `https://api.fanbox.cc/post.listHome` 这种完整域名，用同样方式 grep `api.fanbox.cc`。

---

## 5. 方法 D：curl 复打 + 逐个拿掉请求头

这是从「看到一条 URL」到「确定纸匣该怎么发」之间最重要的一步。

### 5.1 最小复打（公开接口，不必 Cookie）

日榜（已验证：返回 `contents` 数组）：

```bash
curl -sS -D - -o /tmp/rank.json \
  -A "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36" \
  -H "Referer: https://www.pixiv.net/" \
  "https://www.pixiv.net/ranking.php?mode=daily&content=illust&p=1&format=json" \
  | head -n 20

python3 - <<'PY'
import json
d=json.load(open("/tmp/rank.json"))
print("keys", list(d))
print("n", len(d.get("contents") or []), "next", d.get("next"))
print(d["contents"][0]["illust_id"], d["contents"][0]["title"])
PY
```

成功：HTTP 200，JSON 有 `contents`，第一条有 `illust_id`。  
失败：HTML 登录页、Cloudflare 挑战页、空 body。把响应前 200 字打出来看。

作品（把 id 换成你刚在榜里看到的）：

```bash
ID=148997860
curl -sS -A "Mozilla/5.0 …" -H "Referer: https://www.pixiv.net/" \
  "https://www.pixiv.net/ajax/illust/${ID}?lang=zh" | python3 -m json.tool | head
```

期望：`{"error":false,"body":{"illustId":"…","title":"…"} }`。

### 5.2 登录态接口

把 Cookie 换成你自己的，**不要把真实 Cookie 贴进 git / 聊天 / 截图。**

```bash
COOKIE='PHPSESSID=12345678_把这里换成你的'
UID=12345678   # 下划线前面那串

curl -sS -A "Mozilla/5.0 …" \
  -H "Referer: https://www.pixiv.net/" \
  -H "Cookie: $COOKIE" \
  -H "x-userid: $UID" \
  "https://www.pixiv.net/ajax/discovery/artworks?mode=safe&limit=20&lang=zh"
```

FANBOX：

```bash
curl -sS -A "Mozilla/5.0 …" \
  -H "Origin: https://www.fanbox.cc" \
  -H "Referer: https://www.fanbox.cc/" \
  -H "Cookie: FANBOXSESSID=${COOKIE#PHPSESSID=}; PHPSESSID=${COOKIE#PHPSESSID=}" \
  "https://api.fanbox.cc/user.info"
```

### 5.3 头的消融实验（定位 401/403）

同一条 URL，每次少带一个头，列表记录状态码：

| 实验 | Pixiv 典型结果 | FANBOX 典型结果 |
| --- | --- | --- |
| 完整头 | 200 | 200 |
| 去掉 Cookie | 公开榜还行；推荐 401 | 动态 401 |
| Cookie 用访客值（无下划线） | 401 / `error:true` | 401 |
| 去掉 `Referer` | 部分 ajax 仍 200；**pximg 图片 403** | 偶发 403 |
| 去掉 `Origin` | 影响较小 | **经常 401** |
| 去掉 `x-userid` | 部分 ajax 变游客数据或 401 | — |
| 去掉 `User-Agent` | 偶发 403 / 挑战页 | 偶发 403 |

纸匣里这些头写死在 `upstream.server.ts` 的 `upstreamJson`：Pixiv 自动加 Referer + `x-userid`；FANBOX 自动加 Origin + Referer。

### 5.4 POST（红心 / 收藏）

先 GET 首页 HTML，抠 CSRF：

```bash
curl -sS -A "Mozilla/5.0 …" -H "Cookie: $COOKIE" -H "Referer: https://www.pixiv.net/" \
  https://www.pixiv.net/ | python3 - <<'PY'
import sys,re
html=sys.stdin.read()
m=re.search(r'"token"\s*:\s*"([a-f0-9]{16,})"', html)
print("token", m.group(1) if m else "NOT FOUND")
PY
```

再 POST（例子：红心）：

```bash
curl -sS -A "Mozilla/5.0 …" \
  -H "Referer: https://www.pixiv.net/" \
  -H "Origin: https://www.pixiv.net" \
  -H "Cookie: $COOKIE" \
  -H "x-userid: $UID" \
  -H "x-csrf-token: $TOKEN" \
  -H "Content-Type: application/json" \
  --data '{"illust_id":"148997860"}' \
  https://www.pixiv.net/ajax/illusts/like
```

对应代码：`src/lib/social.server.ts` 的 `pixivToken()` + `pixivJson()`。

---

## 6. 方法 E：Cookie 到底怎么认

### 6.1 本机面板

1. F12 → **Application**（有的中文版叫「应用程序」或「存储」）
2. 左侧 Cookies → `https://www.pixiv.net`
3. 找到 `PHPSESSID`，复制 **Value**（不要带名字本身也行，纸匣两种都吃）

FANBOX 看 `https://www.fanbox.cc` 下的 `FANBOXSESSID`。

### 6.2 已登录 vs 访客（必须会）

```text
已登录  12345678_abcdef0123456789deadbeef     ← 数字ID + 下划线 + 长令牌
访客    abcdef0123456789deadbeef              ← 登录页一打开就有，不能用
```

正则（纸匣用的）：`/^(\d{2,12})_([A-Za-z0-9]{16,})$/`  
代码：`src/lib/browser-login.ts` 的 `isPixivLoggedInSession`。

**坑：** 打开登录页的瞬间就会种下访客 `PHPSESSID`。如果这时就「抓到 Cookie 了」并关掉窗口，后面全是 401，也没有头像用户名。必须等到值变成 `ID_令牌`，并且（FANBOX）经过 `/auth/start`。

### 6.3 无头环境用 CDP 读 Cookie

登录中转已经在做这件事：`Network.getAllCookies`，然后 `pickSession` 只留下已登录的 `PHPSESSID` / `FANBOXSESSID`。自己试：

```js
const cdp = await page.createCDPSession();
const { cookies } = await cdp.send("Network.getAllCookies");
for (const c of cookies) {
  if (/^(PHPSESSID|FANBOXSESSID)$/i.test(c.name)) {
    console.log(c.domain, c.name, c.value.slice(0, 12) + "…", c.httpOnly);
  }
}
```

HttpOnly=true 时，页面 JS 和书签脚本都读不到，所以必须走 CDP 或手贴。

### 6.4 FANBOX 登录回转（401 的根因）

正确入口：

```text
https://accounts.pixiv.net/login
  ?prompt=select_account
  &return_to=https%3A%2F%2Fwww.fanbox.cc%2Fauth%2Fstart
  &source=fanbox
```

流程：Pixiv 选账号 → 302 到 `https://www.fanbox.cc/auth/start` → 这里才写下可用的 `FANBOXSESSID`。  
只打开 `https://www.fanbox.cc/` 会拿到访客令牌，`user.info` / `post.listHome` 全 401。

---

## 7. 方法 F：从 HTML 抠 JSON

接口失败时，页面里往往已经嵌了一份同样的数据。

Pixiv 首页 / 作品页：

- `<meta id="meta-global-data" content='…json…'>` → `userData`
- 或源码里 `"userData":{…}`、`pixiv.user.id = "…"`

FANBOX 页面：`"userId"`、`"iconUrl"`。

做法：

```bash
curl -sS -A "Mozilla/5.0 …" -H "Cookie: $COOKIE" https://www.pixiv.net/ -o /tmp/home.html
python3 - <<'PY'
import re,json,html
s=open("/tmp/home.html",encoding="utf-8",errors="ignore").read()
m=re.search(r'id="meta-global-data"[^>]*content="([^"]+)"', s) or re.search(r"content='([^']+)'", s)
if m:
    data=json.loads(html.unescape(m.group(1)))
    print(data.get("userData") or list(data)[:10])
else:
    print("no meta-global-data")
PY
```

纸匣：`src/lib/site-identity.ts` 的 `parsePixivMe` / `parseFanboxMe`。

---

## 8. 三场实战

### 8.1 日榜：同一 URL 加 `format=json`

现象：打开 `/ranking.php?mode=daily` 只看到 HTML。  
动作：方法 D 对 **同一个路径** 加上 `&format=json`。  
结果：

```json
{
  "contents": [
    {
      "illust_id": 148997860,
      "title": "…",
      "user_name": "…",
      "user_id": 2642047,
      "url": "https://i.pximg.net/c/240x480/img-master/…_p0_master1200.jpg"
    }
  ],
  "next": 2,
  "date": "20260830"
}
```

纸匣映射：`illust_id` → `id`，`user_name` → `author`（见 `mapPixivCard`）。翻页用 `next`。

### 8.2 作品：`/ajax/illust/{id}`

从榜单拿一个 `illust_id`，GET：

```
https://www.pixiv.net/ajax/illust/{id}?lang=zh
https://www.pixiv.net/ajax/illust/{id}/pages?lang=zh
```

`body.urls` 里有 `thumb` / `regular` / `original`。原图域名 `i.pximg.net`，**浏览器直接开会 403**，必须 Referer 为 `https://www.pixiv.net/`。所以纸匣不把原图链丢给前端，一律 `/api/media?u=…` 由服务端代拿。

动图再打 `/ajax/illust/{id}/ugoira_meta?lang=zh` 拿 zip 和帧延时。

### 8.3 FANBOX `user.info`：Origin 是开关

```bash
# 会 401（缺 Origin，或 Cookie 是访客）
curl -sS -A "Mozilla/5.0 …" -H "Cookie: FANBOXSESSID=访客值" \
  https://api.fanbox.cc/user.info

# 已登录会话 + Origin
curl -sS -A "Mozilla/5.0 …" \
  -H "Origin: https://www.fanbox.cc" \
  -H "Referer: https://www.fanbox.cc/" \
  -H "Cookie: FANBOXSESSID=12345678_令牌; PHPSESSID=12345678_令牌" \
  https://api.fanbox.cc/user.info
```

动态列表同理：`https://api.fanbox.cc/post.listHome?limit=10`。

---

## 9. 对照表：失败了先看这里

| 你看到的 | 先查 |
| --- | --- |
| 200 但响应是一大坨 HTML | 没加 `format=json`，或被踢去登录页 |
| 401 | Cookie 是访客 / 没带 / FANBOX 没走 `/auth/start` / FANBOX 没 Origin |
| 403 在 JSON 接口 | User-Agent 被嫌弃，或 Referer 不对 |
| 403 在图片 | pximg 必须 `Referer: https://www.pixiv.net/` |
| `{"error":true,"message":"…"}` | 登录失效，或参数（mode/lang）不对 |
| 有 Cookie 没头像用户名 | 只拿到访客会话；whoami 应打 `touch/ajax/user/self/status` |
| 红心失败 | 没 CSRF：先从首页 HTML 抠 `token` |
| Network 里全是广告 | 没勾选 Fetch/XHR，或过滤词没用 `ajax` |

---

## 10. 写进纸匣时怎么落文件

1. curl 已经 200。把 URL、方法、头、JSON 样例（**去掉 Cookie**）记在 PR 描述或测试里。
2. 读接口 → `src/lib/upstream.server.ts` 的 `dispatchFetch` 分支。公开榜不要强依赖 Cookie。
3. 写接口 → `src/lib/social.server.ts`。
4. 用户名头像 → `site-identity.ts`，兼容 `userId` / `user_id` 两套命名。
5. 解析用 `asString` / `asRecord`，不要假设字段永远存在。
6. 在 `src/lib/*.test.ts` 用一段 **脱敏** JSON 锁住字段路径。
7. Cookie 处理只走 `browser-login.ts`，不要在业务里自己拼 `Cookie:` 头。
8. 永远不要把真实 `PHPSESSID` 写进仓库、changelog、测试、截图。

---

## 11. 和另外一份文档的分工

| 文档 | 内容 |
| --- | --- |
| 本文件 [reverse-engineering.md](reverse-engineering.md) | **怎么动手**（DevTools、无头拦包、拆 JS、curl、Cookie、实战） |
| [upstream.md](upstream.md) | **纸匣已经在用的接口清单**和请求头、代码落点 |

上游随时会改。页面和 Network（或 `sniff-xhr.mjs` 的输出）永远比文档新。文档过时就按第 0 节再走一遍循环，改代码，不要改成「猜 URL」。
