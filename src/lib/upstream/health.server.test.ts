import assert from "node:assert/strict";
import { test } from "node:test";
import {
  getUpstreamHealth,
  recordUpstreamHit,
  resetUpstreamHealthForTest,
} from "./health.server.ts";

test.beforeEach(() => resetUpstreamHealthForTest());

test("per-host aggregation: calls, okRate, p50, lastError", () => {
  recordUpstreamHit("https://www.pixiv.net", true, 100, { at: 1_000 });
  recordUpstreamHit("https://www.pixiv.net", false, 300, { at: 2_000, error: "HTTP 429" });
  recordUpstreamHit("https://www.pixiv.net", true, 200, { at: 3_000 });

  const { hosts } = getUpstreamHealth();
  assert.equal(hosts.length, 1);
  const pixiv = hosts[0];
  assert.equal(pixiv.host, "https://www.pixiv.net");
  assert.equal(pixiv.calls, 3);
  // 2/3 成功；浮点除法精确表示
  assert.ok(Math.abs(pixiv.okRate - 2 / 3) < 1e-12);
  // p50（奇数个样本）= 200
  assert.equal(pixiv.p50Ms, 200);
  assert.equal(pixiv.lastError, "HTTP 429");
  assert.equal(pixiv.lastErrorAt, 2_000);
});

test("ring cap: only the most recent 50 hits are kept per host", () => {
  for (let i = 0; i < 60; i += 1) {
    recordUpstreamHit("https://yande.re", i < 55, i * 10, { at: i, error: "HTTP 500" });
  }
  const { hosts } = getUpstreamHealth();
  const booru = hosts[0];
  assert.equal(booru.calls, 50);
  // 环只留 i=10..59：i=55..59 的 5 次失败在内（okRate 45/50），最后一次失败在 i=59
  assert.ok(Math.abs(booru.okRate - 45 / 50) < 1e-12);
  assert.equal(booru.lastError, "HTTP 500");
  assert.equal(booru.lastErrorAt, 59);
});

test("p50 with even sample count averages the two middle values", () => {
  recordUpstreamHit("https://api.fanbox.cc", true, 100, { at: 1 });
  recordUpstreamHit("https://api.fanbox.cc", true, 101, { at: 2 });
  const { hosts } = getUpstreamHealth();
  assert.equal(hosts[0].p50Ms, 101); // round((100+101)/2)，四舍五入取 101
});

test("lastError survives later successes and is per-host", () => {
  recordUpstreamHit("https://www.pixiv.net", false, 50, { at: 10, error: "HTTP 401" });
  recordUpstreamHit("https://www.pixiv.net", true, 60, { at: 20 });
  recordUpstreamHit("https://www.fanbox.cc", true, 70, { at: 30 });

  const { hosts } = getUpstreamHealth();
  const pixiv = hosts.find((h) => h.host === "https://www.pixiv.net")!;
  const fanbox = hosts.find((h) => h.host === "https://www.fanbox.cc")!;
  assert.equal(pixiv.lastError, "HTTP 401");
  assert.equal(pixiv.lastErrorAt, 10);
  assert.equal(fanbox.lastError, null);
  assert.equal(fanbox.lastErrorAt, null);
  // hosts 按字母序稳定输出
  assert.deepEqual(hosts.map((h) => h.host), ["https://www.fanbox.cc", "https://www.pixiv.net"]);
});

test("empty ring yields empty hosts list; blank host is ignored", () => {
  assert.deepEqual(getUpstreamHealth(), { hosts: [] });
  recordUpstreamHit("", true, 10, { at: 1 });
  assert.deepEqual(getUpstreamHealth(), { hosts: [] });
});
