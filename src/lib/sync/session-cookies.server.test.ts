/**
 * kami_x 会话镜像（X 账号关联 M4）。
 *
 * 作用：锁「X Cookie 落 HttpOnly 镜像前必须过 sanitizeXCookie（缺一字段不落）、
 *       有效 30 天 / 无效即焚」「Set-Cookie 头形态照抄现有三枚」——/api/source
 *       读回兜底依赖镜像里永远只有规范形态。
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { kamiSessionCookies, kamiSessionSetCookieHeader } from "./session-cookies.server.ts";

const TOKEN = "a".repeat(40);
const CT0 = "b".repeat(40);
const X_OK = `auth_token=${TOKEN}; ct0=${CT0}`;

test("kami_x：有效 X Cookie 落镜像（30 天），其余 Cookie 噪声字段不进镜像", () => {
  const list = kamiSessionCookies({ x: `guest_id=v1%3A1; ${X_OK}; twid=u%3D2` });
  const x = list.find((c) => c.name === "kami_x");
  assert.ok(x, "kami_x 必须在镜像列表里");
  assert.equal(x.value, encodeURIComponent(X_OK), "镜像值是 sanitize 后的规范形态");
  assert.equal(x.maxAge, 2592000, "30 天（2592000 秒），照抄现有三枚");
});

test("kami_x：缺 auth_token / 缺 ct0 / 空值 → 即焚（maxAge 0）", () => {
  for (const bad of [`auth_token=${TOKEN}`, `ct0=${CT0}`, "", undefined]) {
    const list = kamiSessionCookies({ x: bad });
    const x = list.find((c) => c.name === "kami_x");
    assert.ok(x);
    assert.equal(x.value, "", "无效会话不落值");
    assert.equal(x.maxAge, 0, "maxAge 0 = 删除现有镜像");
  }
});

test("kami_x 的 Set-Cookie 头与现有三枚同形态（HttpOnly / SameSite=Lax / Path=/）", () => {
  const [x] = kamiSessionCookies({ x: X_OK }).filter((c) => c.name === "kami_x");
  assert.ok(x);
  assert.equal(
    kamiSessionSetCookieHeader(x),
    `kami_x=${encodeURIComponent(X_OK)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000`,
  );
});

test("不带 x 的会话写入（pixiv 登录等场景）也产出 kami_x 条目，值为空即焚", () => {
  // syncSessions 每次 POST 都重建全部镜像——没带 x 时必须显式清掉旧镜像，
  // 否则换账号后失效的 X Cookie 一直挂在 HttpOnly 里
  const list = kamiSessionCookies({ pixiv: "11111111_testhashvalue" });
  const x = list.find((c) => c.name === "kami_x");
  assert.ok(x);
  assert.equal(x.value, "");
  assert.equal(x.maxAge, 0);
});
