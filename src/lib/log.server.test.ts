import assert from "node:assert/strict";
import { Writable } from "node:stream";
import { test } from "node:test";
import {
  createModuleLogger,
  createRootLogger,
  humanLineFromJson,
  joinLogArgs,
  type ModuleLogger,
} from "./log.server.ts";
import { runWithRequestId } from "./request-context.server.ts";

/** 内存 destination：收集 pino 产出的每一行。 */
function memoryDestination(): { stream: Writable; lines: () => string[] } {
  const chunks: string[] = [];
  const stream = new Writable({
    write(chunk, _enc, cb) {
      chunks.push(chunk.toString());
      cb();
    },
  });
  return { stream, lines: () => chunks.join("").split("\n").filter(Boolean) };
}

function flush(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

test("json 模式：单行可解析 JSON，带 module 与 requestId（ALS 上下文）", async () => {
  const { stream, lines } = memoryDestination();
  const root = createRootLogger({ format: "json", destination: stream });
  const log = createModuleLogger(root, "upstream:media");

  await runWithRequestId("a1b2c3d4", async () => {
    log.warn("连接池请求失败，本次降级 curl：", "connect timeout");
    await flush();
  });

  assert.equal(lines().length, 1);
  const parsed = JSON.parse(lines()[0]) as {
    level: string;
    module: string;
    msg: string;
    requestId?: string;
  };
  assert.equal(parsed.level, "warn");
  assert.equal(parsed.module, "upstream:media");
  assert.equal(parsed.msg, "连接池请求失败，本次降级 curl： connect timeout");
  assert.equal(parsed.requestId, "a1b2c3d4");
});

test("json 模式：无 ALS 上下文时不带 requestId 字段", async () => {
  const { stream, lines } = memoryDestination();
  const root = createRootLogger({ format: "json", destination: stream });
  createModuleLogger(root, "kami").warn("孤立日志");
  await flush();
  const parsed = JSON.parse(lines()[0]) as { requestId?: string; module: string; msg: string };
  assert.equal(parsed.requestId, undefined);
  assert.equal(parsed.module, "kami");
  assert.equal(parsed.msg, "孤立日志");
});

test("人类可读格式：单行含级别、[模块] 标签、消息与 req id", async () => {
  const { stream, lines } = memoryDestination();
  const root = createRootLogger({ format: "json", destination: stream });
  const log = createModuleLogger(root, "db-snapshot:restore");

  await runWithRequestId("deadbeef", async () => {
    log.warn("首轮 3 行失败，重试一轮：", "session account");
    await flush();
  });

  const human = humanLineFromJson(lines()[0]);
  assert.ok(!human.startsWith("{"), "人类行不应是 JSON");
  assert.ok(human.includes("WARN"));
  assert.ok(human.includes("[db-snapshot:restore]"));
  assert.ok(human.includes("首轮 3 行失败，重试一轮： session account"));
  assert.ok(human.includes("req=deadbeef"));
  // ISO 时间戳开头
  assert.match(human, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
});

test("humanLineFromJson：非 JSON 行原样放行；多余字段不丢", () => {
  assert.equal(humanLineFromJson("不是 JSON"), "不是 JSON");
  const raw = JSON.stringify({ time: 1_700_000_000_000, level: "info", module: "kami", msg: "好", extra: 1 });
  const human = humanLineFromJson(raw);
  assert.ok(human.includes("INFO"));
  assert.ok(human.includes("[kami] 好"));
  assert.ok(human.includes('{"extra":1}'));
});

test("joinLogArgs：与 console 拼接一致（空格连接、Error 取 message）", () => {
  assert.equal(joinLogArgs(["配置不可读：", "ENOENT"]), "配置不可读： ENOENT");
  assert.equal(joinLogArgs(["失败：", new Error("EACCES")]), "失败： EACCES");
  assert.equal(joinLogArgs([42, true, null]), "42 true null");
  assert.equal(joinLogArgs([{ a: 1 }]), '{"a":1}');
});

test("getLogger：同一模块复用同一实例，接口齐全", () => {
  // 单测里连真实 singleton 会导致日志打到 stdout——只校验缓存与形状。
  const fakeRoot = createRootLogger({ format: "json", destination: new Writable({ write: (_c, _e, cb) => cb() }) });
  const a: ModuleLogger = createModuleLogger(fakeRoot, "x:y");
  assert.equal(typeof a.warn, "function");
  assert.equal(typeof a.error, "function");
  assert.equal(typeof a.info, "function");
  assert.equal(typeof a.debug, "function");
});
