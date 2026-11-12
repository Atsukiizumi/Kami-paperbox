/**
 * 卫生批③回归锁：重定向目标逐跳过闸（mediaHopTarget）。
 *
 * 作用：锁住「Location 必须先解析成绝对地址，再走白名单 + 私网判断 +
 *       解析钉扎」——白名单外主机 / 私网 IP / 非 https 协议一律拒，
 *       不再裸跟 -L / redirect:follow。
 * 注意：本机若配了出站代理（.data/proxy.json），解析与钉扎由代理侧接手，
 *       相关断言按形态分支；白名单 / 协议 / 私网字面量拒绝与代理无关。
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { mediaHopTarget } from "./media.ts";
import { setHostGuardInternalsForTests } from "./media-host-guard.server.ts";
import { getActiveProxy } from "../proxy.server.ts";

test("重定向目标过白名单+私网+钉扎闸（卫生批③）", async () => {
  setHostGuardInternalsForTests({
    resolve: async (host) => {
      if (host === "files.yande.re") return [{ address: "210.140.139.150", family: 4 }];
      // 白名单域被 DNS 摆到私网：必须拒（rebinding 类）
      if (host === "danbooru.donmai.us") return [{ address: "127.0.0.1", family: 4 }];
      return [{ address: "8.8.8.8", family: 4 }];
    },
  });
  const viaProxy = Boolean(getActiveProxy());
  try {
    const base = new URL("https://files.yande.re/post/a.jpg");
    // 绝对地址跳白名单内主机：放行
    const ok = await mediaHopTarget("https://cdn.donmai.us/x.jpg", base);
    assert.equal(ok.url.hostname, "cdn.donmai.us");
    if (!viaProxy) assert.equal(ok.pin[0], "8.8.8.8", "无代理时给出钉扎地址");
    // 相对 Location 按当前地址解析
    const rel = await mediaHopTarget("/b.jpg", base);
    assert.equal(rel.url.toString(), "https://files.yande.re/b.jpg");
    if (!viaProxy) assert.deepEqual(rel.pin, ["210.140.139.150"]);
    // 白名单外主机：拒（与代理无关）
    await assert.rejects(mediaHopTarget("https://evil.com/a.jpg", base), /不支持|非法/);
    // 非 https 协议（javascript: 是合法绝对 URL，必须在白名单闸被拦）
    await assert.rejects(mediaHopTarget("javascript:alert(1)", base), /只允许|非法/);
    // 私网 IP 字面量：拒（与代理无关；http 协议先被 https 闸拦，同为拒绝）
    await assert.rejects(mediaHopTarget("http://127.0.0.1/x", base), /只允许|非法/);
    await assert.rejects(mediaHopTarget("https://127.0.0.1/x", base), /非法/, "https 形态落到私网闸");
    // 白名单域但解析到私网（rebinding）：拒（无代理形态）
    if (!viaProxy) {
      await assert.rejects(mediaHopTarget("https://danbooru.donmai.us/y.jpg", base), /非法/);
    }
  } finally {
    setHostGuardInternalsForTests(null);
  }
});
