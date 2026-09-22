/**
 * /api/version 探测逻辑（D1）：current 来源、latest 成功/失败降级、
 * hasUpdate 口径（dev 不提示、latest 缺席不提示）、24h 缓存命中不打上游。
 */
import assert from "node:assert/strict";
import { test, beforeEach } from "node:test";
import { probeVersion, resetVersionProbeCache } from "./version.ts";

beforeEach(() => resetVersionProbeCache());

const okTags = (async () =>
  new Response(JSON.stringify([{ name: "v9.9.9" }]), {
    status: 200,
    headers: { "content-type": "application/json" },
  })) as typeof fetch;

test("current 来自 KAMI_VERSION；latest 命中且不同 → hasUpdate", async () => {
  process.env.KAMI_VERSION = "v0.10.8";
  try {
    const r = await probeVersion(okTags);
    assert.equal(r.current, "v0.10.8");
    assert.equal(r.latest, "v9.9.9");
    assert.equal(r.hasUpdate, true);
  } finally {
    delete process.env.KAMI_VERSION;
  }
});

test("dev 形态不提示升级；latest 与 current 相同不提示", async () => {
  process.env.KAMI_VERSION = "v9.9.9";
  try {
    const same = await probeVersion(okTags);
    assert.equal(same.hasUpdate, false, "同版本");
    resetVersionProbeCache();
    delete process.env.KAMI_VERSION;
    const dev = await probeVersion(okTags);
    assert.equal(dev.current, "dev");
    assert.equal(dev.hasUpdate, false, "dev 不比");
  } finally {
    delete process.env.KAMI_VERSION;
  }
});

test("不可比/不旧的形态不误报：sha- 镜像与「latest 之后」的 describe", async () => {
  // CI main 推送镜像（compose 默认 :latest 的来源）：与 tag 无序，永不提示
  process.env.KAMI_VERSION = "sha-838abaef2a927";
  try {
    const shaBuild = await probeVersion(okTags);
    assert.equal(shaBuild.hasUpdate, false, "sha- 形态不可比不提示");
    resetVersionProbeCache();
    // git describe 的「tag-N-g<sha>」= HEAD 在 latest tag 之后，不比 latest 旧
    process.env.KAMI_VERSION = "v9.9.9-3-g838abae";
    const afterTag = await probeVersion(okTags);
    assert.equal(afterTag.hasUpdate, false, "describe 在 tag 之后不提示");
    resetVersionProbeCache();
    // 真·旧 tag 钉住的镜像照常提示
    process.env.KAMI_VERSION = "v0.10.3";
    const older = await probeVersion(okTags);
    assert.equal(older.hasUpdate, true, "旧 tag 仍提示升级");
  } finally {
    delete process.env.KAMI_VERSION;
  }
});

test("探测失败/非 2xx → latest 缺席静默降级；24h 缓存内二次调用不打上游", async () => {
  let calls = 0;
  const failing = (async () => {
    calls += 1;
    return new Response("nope", { status: 404 });
  }) as typeof fetch;
  const r1 = await probeVersion(failing);
  assert.equal(r1.latest, undefined);
  assert.equal(r1.hasUpdate, false);
  const r2 = await probeVersion(failing);
  assert.equal(calls, 1, "缓存命中不再打上游");
  assert.equal(r2.checkedAt, r1.checkedAt);
});
