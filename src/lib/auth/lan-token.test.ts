import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { LAN_TOKEN_COOKIE, isValidLanTokenShape } from "../lan-pairing.ts";

test("lan token 形状校验", () => {
  assert.equal(isValidLanTokenShape("a".repeat(24)), true);
  assert.equal(isValidLanTokenShape(""), false);
  assert.equal(isValidLanTokenShape("short"), false); // 20 字节下限
  assert.equal(isValidLanTokenShape("含空格 的令牌"), false);
  assert.equal(isValidLanTokenShape("a".repeat(65)), false);
});

test("lanTokenFromRequest 三通道取值", async () => {
  process.env.KAMI_ROOT = mkdtempSync(join(tmpdir(), "kami-lan-"));
  const mod = await import("./lan-token.server.ts");
  try {
    // header
    const viaHeader = mod.lanTokenFromRequest(
      new Request("http://x/api/vault", { headers: { authorization: "Bearer abc-def_123" } }),
    );
    assert.equal(viaHeader, "abc-def_123");
    // query（curl / 一次性链接兜底）
    const viaQuery = mod.lanTokenFromRequest(new Request("http://x/api/media?u=1&token=q1w2e3r4t5y6"));
    assert.equal(viaQuery, "q1w2e3r4t5y6");
    // cookie（<img> 主通道）
    const viaCookie = mod.lanTokenFromRequest(
      new Request("http://x/api/media?u=1", { headers: { cookie: `a=1; ${LAN_TOKEN_COOKIE}=z9x8c7v6b5n4; b=2` } }),
    );
    assert.equal(viaCookie, "z9x8c7v6b5n4");
    // 都没有
    assert.equal(mod.lanTokenFromRequest(new Request("http://x/api/vault")), null);
  } finally {
    rmSync(process.env.KAMI_ROOT, { recursive: true, force: true });
    delete process.env.KAMI_ROOT;
  }
});

test("readLanToken 生成、落盘、进程内复用、校验", async () => {
  // readLanToken 有进程级缓存，与 lanTokenMatches 合并成一个用例、一个目录。
  const dir = mkdtempSync(join(tmpdir(), "kami-lan-"));
  process.env.KAMI_ROOT = dir;
  const mod = await import("./lan-token.server.ts");
  try {
    const token = mod.readLanToken();
    assert.ok(isValidLanTokenShape(token));
    const file = JSON.parse(readFileSync(join(dir, ".data", "lan-token.json"), "utf8")) as {
      token: string;
    };
    assert.equal(file.token, token);
    assert.equal(mod.readLanToken(), token);
    assert.equal(mod.lanTokenMatches(token, token), true);
    assert.equal(mod.lanTokenMatches(`${token}x`, token), false);
    assert.equal(mod.lanTokenMatches("", token), false);
    assert.equal(mod.lanTokenMatches(token, "not-the-token-at-all-1234"), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    delete process.env.KAMI_ROOT;
  }
});
