# Pixiv 认证流程

纸匣只走 **网页会话**（Cookie）。下面把市面上会碰到的三条线写清楚，避免和「官方开放平台」「App API」搅在一起。

密码只在官方登录页上打。纸匣不接用户名密码、不接 App OAuth。

---

## 三条线

```text
① 身份：accounts.pixiv.net     登录、选账号、跳回业务站
② 网页 API：www.pixiv.net/ajax  Cookie PHPSESSID +（写操作）CSRF
③ App API：app-api.pixiv.net    OAuth2 Bearer（refresh_token）
```

| | 网页 API（纸匣） | App API（pixivpy 一类） | 开放平台 |
| --- | --- | --- | --- |
| 谁在用 | 浏览器、PixivFE、纸匣 | 非官方客户端 | 合作方申请 |
| 登录态 | `PHPSESSID` | `access_token` / `refresh_token` | OAuth client |
| 读榜 / 搜 / 作品 | `/ajax/…`、`ranking.php` | `app-api.pixiv.net/v1/…` | 有限 |
| 红心收藏 | POST + `x-csrf-token` | App 自己的 POST | 看权限 |
| 密码登录 | 官方页，然后种 Cookie | 2021-02 起废了 | 授权码 |
| 纸匣 | **这条** | 不用 | 不用 |

三条线的登录入口都是 `accounts.pixiv.net`，但换回来的凭证不一样。

---

## 1. 身份：accounts.pixiv.net

用户打开：

```
https://accounts.pixiv.net/login
  ?return_to=https://www.pixiv.net/
  &source=pc
  &view_type=page
```

FANBOX 把 `return_to` 换成 `https://www.fanbox.cc/auth/start`，并加 `prompt=select_account&source=fanbox`。

这一步会：

1. 立刻种一枚 **访客** `PHPSESSID`（一串没有下划线的随机值）。
2. 用户用密码 / 社交账号 / Passkey 登进去。
3. 会话变成 **`{用户数字ID}_{令牌}`**。
4. 302 到 `return_to`。FANBOX 还要过 `/auth/start`，才会有可用的 `FANBOXSESSID`。

代码里的正规表达式：`src/lib/browser-login.ts` 的 `PIXIV_SESSION_RE`。

```
已登录  12345678_AaBbCcDdEeFf…
访客    8f3a1c9e0b2d4f6a          ← 没有「数字ID_」，纸匣丢掉
```

下划线前面那截就是用户 ID，请求头 `x-userid` 用它。

登出、改密码、长时间不用，会话会作废。之后 `/ajax/` 会 `{ "error": true }`，写操作 401/403。

---

## 2. 网页 API（纸匣实际在走）

浏览器登录之后，前端打的是同源 XHR。纸匣服务端带同一份 Cookie 原样复打。

### 2.1 读

```
GET https://www.pixiv.net/ajax/illust/{id}?lang=zh
Cookie: PHPSESSID={用户ID}_{令牌}
Referer: https://www.pixiv.net/
User-Agent: Mozilla/5.0 …
x-userid: {用户ID}          # 有登录才加
```

公开榜 `ranking.php?format=json` 可以不带 Cookie。R-18、关注、推荐、收藏夹必须带已登录会话。

返回：

```json
{ "error": false, "message": "", "body": { } }
```

`error: true` 当登录失效或参数不对。

### 2.2 写（红心 / 收藏 / 关注）

网页会多带一个 **CSRF token**。不是 Cookie，是页面 HTML 里的字段，常见位置：

- `<meta id="meta-global-data" content='{"token":"…"}'>`（可能被写成 `\u0026quot;`）
- `__NEXT_DATA__` → `api.token`
- 旧页 `pixiv.context.token`

请求：

```
POST https://www.pixiv.net/ajax/illusts/like
Cookie: PHPSESSID=…
Origin: https://www.pixiv.net
Referer: https://www.pixiv.net/
x-csrf-token: {从 HTML 抠的 token}
x-userid: {用户ID}
Content-Type: application/json
{"illust_id":"123"}
```

没有 `x-csrf-token`，或 token 过期，会 403。纸匣在 `social.server.ts` 里把 token 缓存约 8 分钟；登录后会预热，避免点红心时先扒一整页首页。

关注还走老表单 `bookmark_add.php`，token 放在字段 `tt`。

### 2.3 图

原图在 `i.pximg.net`。CDN 认 Referer，直链 403。纸匣只让浏览器请求 `/api/media?u=…`，由服务端带 `Referer: https://www.pixiv.net/` 去拉。

### 2.4 时序

```text
浏览器 / 设置里登录
        │  密码打在 accounts.pixiv.net
        ▼
PHPSESSID = {id}_{token}     （访客那种丢掉）
        │
        ├─ GET /ajax/…          读榜、作品、搜索
        │
        ├─ GET www.pixiv.net/   抠 CSRF（写操作用，可预热）
        │
        └─ POST /ajax/illusts/like
              Cookie + x-csrf-token + x-userid
```

---

## 3. App API（纸匣不用）

官方 iOS / Android 走另一套：

```
登录页（PKCE）
  https://app-api.pixiv.net/web/v1/login?code_challenge=…&code_challenge_method=S256

换票
  POST https://oauth.secure.pixiv.net/auth/token
  grant_type=authorization_code | refresh_token

调接口
  GET https://app-api.pixiv.net/v1/…
  Authorization: Bearer {access_token}
```

2021 年 2 月起，用户名+密码换 token 废了。现在非官方库（pixivpy 等）要：

1. 用官方 App 的 client_id（从 App 里抠出来的，不是你申请的）走 PKCE，或
2. 抓包得到 `refresh_token`，以后只 refresh。

`access_token` 很快过期，靠 `refresh_token` 续。这套 **不能** 和网页 `PHPSESSID` 互换：有 Cookie 换不到 Bearer，有 Bearer 也当不了网页 CSRF。

纸匣不冒充官方 App，所以不存 refresh_token、不打 `oauth.secure.pixiv.net`。

---

## 4. 开放平台

[developers.pixiv.net](https://www.pixiv.net/premium) 一类合作方 OAuth，权限窄，没有纸匣要的榜单 / 红心 / 原图通道。申请也轮不到个人备份工具。

---

## 5. FANBOX 和 Pixiv 的关系

同一套账号。FANBOX 的 JSON 在 `api.fanbox.cc`，要：

```
Cookie: FANBOXSESSID={id}_{token}; PHPSESSID={同一份或 Pixiv 那份}
Origin: https://www.fanbox.cc
Referer: https://www.fanbox.cc/
```

只登 Pixiv、没走过 `/auth/start`，FANBOX 会 401。纸匣在没有合格 `FANBOXSESSID` 时，会用已登录的 Pixiv `PHPSESSID` 去填（`fanboxCookieHeader`）。

---

## 6. 和纸匣代码的对应

| 步骤 | 代码 |
| --- | --- |
| 登录 URL、已登录正则、拼 Cookie 头 | `src/lib/browser-login.ts` |
| 读 `/ajax`、榜单 | `src/lib/upstream.server.ts` |
| CSRF、红心收藏关注 | `src/lib/social.server.ts` |
| 预热 CSRF | `warmPixivCsrf`（`src/lib/source.ts`） |
| 动手怎么拦包 | [reverse-engineering.md](reverse-engineering.md) |
| 已在用的 URL | [upstream.md](upstream.md) |

不要用 App API 的 Bearer 去打 `/ajax/`，也不要用 `PHPSESSID` 去打 `oauth.secure.pixiv.net`。
