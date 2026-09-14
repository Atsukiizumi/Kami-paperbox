/**
 * 服务端结构化日志（pino 包装，M2 可观测性）。
 *
 * 作用：统一 .server 层日志出口——缺省单行人类可读，KAMI_LOG_FORMAT=json
 *      切 JSON 行；每行自动带模块标签与当前请求 id（request-context.server）。
 * 用法：`const log = getLogger("模块:操作"); log.warn("消息：", detail);`
 *      参数拼接行为与 console.warn 一致（空格连接、Error 取 message），
 *      迁移旧调用点就是把 `"[模块:操作] "` 前缀从消息挪进 getLogger。
 *      仅限服务端文件 import（.server 后缀边界，eslint M10 会拦客户端）。
 * 为什么：报障对账需要「同一请求的日志链」，裸 console 没有请求概念；
 *      pino-pretty 属额外传输依赖（design.md M2 禁用），人类可读格式用
 *      进程内 transform 流把 pino 的 JSON 行重排实现，零传输依赖。
 */
import { Transform } from "node:stream";
import pino from "pino";
import { getRequestId } from "./request-context.server.ts";

export type ModuleLogger = {
  debug: (...args: unknown[]) => void;
  info: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
};

const JSON_MODE = process.env.KAMI_LOG_FORMAT === "json";

/**
 * 把 pino 的一条 JSON 行重排成 `时间 级别 [模块] 消息 req=xxxx` 单行；
 * 解析失败原样放行（防御：pino 内部格式变动不该吞日志）。
 */
export function humanLineFromJson(raw: string): string {
  let obj: Record<string, unknown>;
  try {
    obj = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return raw;
  }
  const time = typeof obj.time === "number" ? new Date(obj.time).toISOString() : new Date().toISOString();
  const level = String(obj.level ?? "log").toUpperCase();
  const module = typeof obj.module === "string" ? `[${obj.module}] ` : "";
  const req = typeof obj.requestId === "string" ? ` req=${obj.requestId}` : "";
  const rest = { ...obj };
  delete rest.time;
  delete rest.level;
  delete rest.module;
  delete rest.requestId;
  const msg = typeof rest.msg === "string" ? rest.msg : "";
  delete rest.msg;
  // 额外业务字段极少出现（本包装只产 module/msg/requestId），有就原样 JSON 附在行尾。
  const extra = Object.keys(rest).length ? ` ${JSON.stringify(rest)}` : "";
  return `${time} ${level} ${module}${msg}${req}${extra}`;
}

function humanDestination(): Transform {
  let pending = "";
  const human = new Transform({
    transform(chunk, _enc, cb) {
      pending += typeof chunk === "string" ? chunk : chunk.toString();
      let out = "";
      let idx: number;
      while ((idx = pending.indexOf("\n")) >= 0) {
        const line = pending.slice(0, idx);
        pending = pending.slice(idx + 1);
        if (line) out += `${humanLineFromJson(line)}\n`;
      }
      cb(null, out);
    },
    flush(cb) {
      cb(null, pending ? `${humanLineFromJson(pending)}\n` : null);
    },
  });
  human.pipe(process.stdout);
  return human;
}

/**
 * 构造根 logger。destination 供测试注入内存流；缺省 JSON 模式直写 stdout，
 * 人类模式经 humanDestination 重排。
 */
export function createRootLogger(
  opts: { format?: "human" | "json"; destination?: pino.DestinationStream } = {},
): pino.Logger {
  const format = opts.format ?? (JSON_MODE ? "json" : "human");
  let destination = opts.destination;
  if (!destination && format === "human") destination = humanDestination();
  return pino(
    {
      level: process.env.KAMI_LOG_LEVEL ?? "info",
      // 单进程自部署形态，pid/hostname 每行都是噪音——清掉默认 base。
      base: {},
      // level 直接落标签（"warn" 而非 30）：JSON 行也是给人 grep 的。
      formatters: { level: (label) => ({ level: label }) },
      mixin: () => {
        const requestId = getRequestId();
        return requestId ? { requestId } : {};
      },
    },
    destination,
  );
}

/** console 风格参数拼接：多参数空格连接；Error 取 message（调用点基本都已自行拆好）。 */
export function joinLogArgs(args: unknown[]): string {
  return args
    .map((arg) => {
      if (typeof arg === "string") return arg;
      if (arg instanceof Error) return arg.message;
      if (typeof arg === "object" && arg !== null) {
        try {
          return JSON.stringify(arg) ?? String(arg);
        } catch {
          return String(arg);
        }
      }
      return String(arg);
    })
    .join(" ");
}

/** 测试注入用：给任意根 logger 绑一个模块子 logger。 */
export function createModuleLogger(root: pino.Logger, module: string): ModuleLogger {
  const child = root.child({ module });
  const emit =
    (level: "debug" | "info" | "warn" | "error") =>
    (...args: unknown[]) => {
      const message = joinLogArgs(args);
      if (testSink) {
        testSink({ level, module, message });
        return;
      }
      child[level](message);
    };
  return { debug: emit("debug"), info: emit("info"), warn: emit("warn"), error: emit("error") };
}

export type ModuleLogEvent = { level: "debug" | "info" | "warn" | "error"; module: string; message: string };

let testSink: ((event: ModuleLogEvent) => void) | null = null;

/**
 * 测试专用：设置后所有模块日志改投 sink（不再写 stdout），传 null 恢复。
 * 为什么：模块文件在 import 时就绑定了 logger，测试换不掉它们的根实例；
 * sink 在发射点生效，服务端单测能断言「告警确实发生了」。
 */
export function setModuleLogSinkForTest(sink: ((event: ModuleLogEvent) => void) | null): void {
  testSink = sink;
}

const moduleCache = new Map<string, ModuleLogger>();
let rootSingleton: pino.Logger | undefined;

export function getLogger(module: string): ModuleLogger {
  const hit = moduleCache.get(module);
  if (hit) return hit;
  rootSingleton ??= createRootLogger();
  const logger = createModuleLogger(rootSingleton, module);
  moduleCache.set(module, logger);
  return logger;
}
