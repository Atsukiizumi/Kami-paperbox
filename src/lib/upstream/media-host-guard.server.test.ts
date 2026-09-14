/**
 * SEC-08 前置修复单测矩阵（media-host-guard.server.ts）。
 *
 * 作用：锁住 IPv4-mapped IPv6、十进制 / 八进制 / 十六进制整数写法、
 *       解析到私网的域名、解析失败 fail-open、TTL 缓存五条判定线。
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  assertHostResolvesPublicly,
  isPrivateIpLiteral,
  normalizeIpLiteral,
  setHostGuardInternalsForTests,
} from "./media-host-guard.server.ts";

test("normalizeIpLiteral 把整数写法折叠成点分 IPv4，域名原样返回", () => {
  assert.equal(normalizeIpLiteral("2130706433"), "127.0.0.1");
  assert.equal(normalizeIpLiteral("0177.0.0.1"), "127.0.0.1");
  assert.equal(normalizeIpLiteral("0x7f000001"), "127.0.0.1");
  assert.equal(normalizeIpLiteral("0x7f.1"), "127.0.0.1");
  assert.equal(normalizeIpLiteral("017700000001"), "127.0.0.1");
  assert.equal(normalizeIpLiteral("127.0.0.1"), "127.0.0.1");
  assert.equal(normalizeIpLiteral("8.8"), "8.0.0.8");
  // 非整数写法：原样返回
  assert.equal(normalizeIpLiteral("i.pximg.net"), "i.pximg.net");
  assert.equal(normalizeIpLiteral("1.2.3.foo"), "1.2.3.foo");
  assert.equal(normalizeIpLiteral(""), "");
  // 2^32 溢出不是 IPv4 字面量
  assert.equal(normalizeIpLiteral("4294967296"), "4294967296");
});

test("isPrivateIpLiteral 覆盖私网 / 回环 / 链路本地 / IPv6 / IPv4-mapped", () => {
  const privates = [
    "127.0.0.1",
    "10.1.2.3",
    "192.168.1.1",
    "172.16.0.1",
    "172.31.255.255",
    "169.254.169.254",
    "0.0.0.0",
    "100.64.0.1",
    "::1",
    "fc00::1",
    "fd12:3456::1",
    "fe80::1",
    "ff02::1",
    // IPv4-mapped：点分与十六进制两种序列化形态都要认
    "::ffff:127.0.0.1",
    "::ffff:7f00:1",
    "::ffff:10.0.0.1",
    "0:0:0:0:0:ffff:c0a8:101", // ::ffff:192.168.1.1
  ];
  for (const ip of privates) {
    assert.equal(isPrivateIpLiteral(ip), true, `${ip} 必须判为私网`);
  }
  const publics = [
    "8.8.8.8",
    "210.140.139.150",
    "2606:4700::1111",
    "2001:db8::1",
    "::ffff:8.8.8.8",
    "::ffff:808:808", // ::ffff:8.8.8.8 的十六进制形态
  ];
  for (const ip of publics) {
    assert.equal(isPrivateIpLiteral(ip), false, `${ip} 不应误判为私网`);
  }
  // 域名不是字面量：返回 false（域名走异步解析检查）
  assert.equal(isPrivateIpLiteral("i.pximg.net"), false);
  // 整数写法要先归一化再判：两步搭配是既定用法
  assert.equal(isPrivateIpLiteral(normalizeIpLiteral("2130706433")), true);
});

test("解析到私网（含 mapped）的域名判不通过，多 A 记录一票否决", async () => {
  setHostGuardInternalsForTests({
    resolve: async (host) => {
      if (host === "rebind.example") return [{ address: "127.0.0.1", family: 4 }];
      if (host === "mixed.example") {
        return [
          { address: "8.8.8.8", family: 4 },
          { address: "10.0.0.5", family: 4 },
        ];
      }
      if (host === "mapped.example") return [{ address: "::ffff:10.0.0.1", family: 4 }];
      return [{ address: "210.140.139.150", family: 4 }];
    },
    now: () => 0,
  });
  try {
    assert.equal(await assertHostResolvesPublicly("rebind.example"), false);
    assert.equal(await assertHostResolvesPublicly("mixed.example"), false, "私网 IP 不能搭公共 A 记录的车");
    assert.equal(await assertHostResolvesPublicly("mapped.example"), false);
    assert.equal(await assertHostResolvesPublicly("public.example"), true);
  } finally {
    setHostGuardInternalsForTests(null);
  }
});

test("解析失败按 fail-open 放行", async () => {
  setHostGuardInternalsForTests({
    resolve: async () => {
      throw new Error("EAI_AGAIN");
    },
    now: () => 0,
  });
  try {
    assert.equal(await assertHostResolvesPublicly("flaky.example"), true);
  } finally {
    setHostGuardInternalsForTests(null);
  }
});

test("TTL 内不重复解析，过期后重新解析", async () => {
  let calls = 0;
  let now = 0;
  setHostGuardInternalsForTests({
    resolve: async () => {
      calls += 1;
      return [{ address: "8.8.8.8", family: 4 }];
    },
    now: () => now,
  });
  try {
    await assertHostResolvesPublicly("hot.example");
    await assertHostResolvesPublicly("hot.example");
    assert.equal(calls, 1, "TTL 内命中缓存");
    now = 5 * 60_000 + 1;
    await assertHostResolvesPublicly("hot.example");
    assert.equal(calls, 2, "过期后重新解析");
  } finally {
    setHostGuardInternalsForTests(null);
  }
});
