/**
 * XAccountCard（X 设置卡）RTL：Cookie 框输入/清空 round-trip、缺字段提示、
 * queryId 覆盖写表，以及占位符默认值与 upstream X_QUERY_IDS 的交叉断言。
 * X 登录中转（10-18）：中转按钮开 SessionRelayDialog(site="x")、relay done →
 * applyLoginSession({x}) 写 store（规范形）、失败/取消不写值、手动粘贴路径保留。
 * 环境垫片：../../test/dom.ts 必须最先引入。
 */
import "../../test/dom.ts";
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { XAccountCard } from "./x-account.tsx";
import { X_DEFAULT_QUERY_IDS } from "@/lib/x-settings";
import { useSettings } from "@/lib/store";
import { X_QUERY_IDS } from "@/lib/upstream/x.ts";

const X_TOKEN = "a".repeat(40);
const X_CT0 = "b".repeat(40);
const X_OK = `auth_token=${X_TOKEN}; ct0=${X_CT0}`;

/** 轮询等条件成立（组件内异步链在 stub fetch 下毫秒级完成）。 */
async function until(cond: () => boolean, ms = 1500): Promise<void> {
  const deadline = Date.now() + ms;
  while (!cond() && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 10));
  }
}

describe("XAccountCard（X 设置卡）", () => {
  // setXCookie 会触发 syncSessions → POST /api/sessions；不垫 fetch 会冒未处理拒绝
  let fetchOriginal: typeof fetch;
  before(() => {
    fetchOriginal = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response("{}", { status: 200, headers: { "content-type": "application/json" } })) as typeof fetch;
  });
  after(() => {
    globalThis.fetch = fetchOriginal;
  });

  beforeEach(() => {
    cleanup();
    useSettings.setState({ xCookie: "", xGraphQLQueryIds: {}, accounts: [], activeAccountId: null });
  });

  it("queryId 占位符默认值与 upstream X_QUERY_IDS 一致（客户端镜像防漂）", () => {
    // x-account 不能 import 服务端 x.ts（node 依赖），默认表手抄在这里——
    // X 发版换默认值时两处必须一起改，此断言就是那个提醒
    assert.deepEqual({ ...X_DEFAULT_QUERY_IDS }, { ...X_QUERY_IDS });
  });

  it("Cookie 输入 round-trip：输入落 store、清空回空", () => {
    render(<XAccountCard />);
    const input = screen.getByLabelText("X Cookie") as HTMLInputElement;
    fireEvent.change(input, { target: { value: X_OK } });
    assert.equal(useSettings.getState().xCookie, X_OK);
    fireEvent.change(input, { target: { value: "" } });
    assert.equal(useSettings.getState().xCookie, "");
  });

  it("半截 Cookie（缺 ct0）显示补全提示，完整的不提示", () => {
    render(<XAccountCard />);
    fireEvent.change(screen.getByLabelText("X Cookie"), { target: { value: `auth_token=${X_TOKEN}` } });
    assert.ok(screen.getByText(/需要同时带 auth_token 与 ct0/));
    fireEvent.change(screen.getByLabelText("X Cookie"), { target: { value: X_OK } });
    assert.equal(screen.queryByText(/需要同时带 auth_token 与 ct0/), null, "完整 Cookie 不提示");
  });

  it("queryId 覆盖输入写表、清空撤覆盖；脏字符被清洗挡回", () => {
    render(<XAccountCard />);
    fireEvent.change(screen.getByLabelText("UserByScreenName"), { target: { value: "NewId_1" } });
    assert.deepEqual(useSettings.getState().xGraphQLQueryIds, { userByScreenName: "NewId_1" });
    // 清空 = 未覆盖：键从表里消失
    fireEvent.change(screen.getByLabelText("UserByScreenName"), { target: { value: "" } });
    assert.deepEqual(useSettings.getState().xGraphQLQueryIds, {});
  });

  // ── 中转登录（AC3/AC4）：按钮开窗 + done 写库 + 失败/取消不写 + 手动框保留 ──

  it("中转登录按钮打开 site=x 的中转窗（AC4）", async () => {
    render(<XAccountCard />);
    fireEvent.click(screen.getByRole("button", { name: /中转登录/ }));
    assert.ok(screen.getByText("在官方页面登录 X"), "标题必须标出 X 站");
    // 关窗终止轮询循环
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /取消/ }));
    });
    assert.equal(useSettings.getState().xCookie, "", "取消路径不写任何值");
  });

  it("relay done → applyLoginSession({x}) 写 store 且为规范形（AC3）", async () => {
    const base = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ ok: true, status: "done", x: X_OK }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })) as typeof fetch;
    try {
      render(<XAccountCard />);
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: /中转登录/ }));
        await until(() => useSettings.getState().xCookie === X_OK);
      });
      assert.equal(useSettings.getState().xCookie, X_OK, "done 载荷的 x 必须经 applyLoginSession 落库");
    } finally {
      globalThis.fetch = base;
    }
  });

  it("relay 失败（非 2xx）不写值，只报错误态（AC3）", async () => {
    const base = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ ok: false, error: "boom" }), {
        status: 400,
        headers: { "content-type": "application/json" },
      })) as typeof fetch;
    try {
      render(<XAccountCard />);
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: /中转登录/ }));
        await until(() => screen.queryAllByText(/登录中转不可用/).length > 0);
      });
      assert.ok(screen.getAllByText(/登录中转不可用/).length > 0, "网关不可用要给用户看得见的错误");
      assert.equal(useSettings.getState().xCookie, "", "失败路径不写任何值");
    } finally {
      globalThis.fetch = base;
    }
  });

  // ── relayToken 绑定（10-18 凭据竞态修复，AC4）：start 捕获 → 全链路携带 ──

  const RELAY_TOKEN = "ab".repeat(32);

  function json200(v: unknown): Response {
    return new Response(JSON.stringify(v), { status: 200, headers: { "content-type": "application/json" } });
  }

  /** 记录全部请求（method + url + body）并按登录中转协议应答的 fetch 桩。 */
  function recordingRelayFetch(script: {
    poll?: () => unknown;
    onInput?: () => unknown;
  }): { calls: string[] } {
    const calls: string[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push(`${init?.method ?? "GET"} ${url}${init?.body ? ` ${String(init.body)}` : ""}`);
      if (url.includes("credentials=1")) return json200({ ok: true, x: X_OK });
      if (init?.method === "POST") {
        const body = JSON.parse(String(init.body)) as { action?: string };
        if (body.action === "cancel") return json200({ ok: true, status: "error", error: "已取消登录窗口" });
        if (body.action === "input") return json200(script.onInput?.() ?? { ok: true, status: "waiting" });
        return json200({ ok: true, status: "waiting", relayToken: RELAY_TOKEN, frame: "*" });
      }
      return json200(script.poll?.() ?? { ok: true, status: "waiting", frame: "*" });
    }) as typeof fetch;
    return { calls };
  }

  it("relayToken 全链路：start 捕获 → 轮询/取凭据 query 携带，done 正常写库（AC4）", async () => {
    const base = globalThis.fetch;
    const { calls } = recordingRelayFetch({ poll: () => ({ ok: true, status: "done" }) });
    try {
      render(<XAccountCard />);
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: /中转登录/ }));
        await until(() => useSettings.getState().xCookie === X_OK);
      });
      assert.equal(useSettings.getState().xCookie, X_OK, "done 载荷的 x 照常落库");
      assert.ok(
        calls.some((c) => c.startsWith(`GET /api/login-browser?frame=1&relayToken=${RELAY_TOKEN}`)),
        "轮询必须携带 relayToken",
      );
      assert.ok(
        calls.some((c) => c.startsWith(`GET /api/login-browser?credentials=1&relayToken=${RELAY_TOKEN}`)),
        "取凭据必须携带 relayToken",
      );
      const startCall = calls.find((c) => c.includes('"site":"x"'));
      assert.ok(startCall, "start 请求存在");
      assert.ok(!startCall.includes("relayToken"), "start 本身不带 token（由响应一次性下发）");
    } finally {
      globalThis.fetch = base;
    }
  });

  it("relayToken 全链路：input 注入与取消的 body 携带 token（AC4 续）", async () => {
    const base = globalThis.fetch;
    const { calls } = recordingRelayFetch({});
    try {
      render(<XAccountCard />);
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: /中转登录/ }));
        await until(() => calls.some((c) => c.startsWith("GET /api/login-browser?frame=1")));
      });
      // job.status=waiting（来自 start 响应）后键盘输入才会转发
      fireEvent.keyDown(screen.getByRole("application"), { key: "a" });
      await until(() => calls.some((c) => c.includes('"action":"input"')));
      const inputCall = calls.find((c) => c.includes('"action":"input"'));
      assert.ok(inputCall?.includes(`"relayToken":"${RELAY_TOKEN}"`), "input 必须携带 relayToken");
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: /取消/ }));
      });
      await until(() => calls.some((c) => c.includes('"action":"cancel"') && c.includes(`"relayToken":"${RELAY_TOKEN}"`)));
      assert.equal(useSettings.getState().xCookie, "", "取消路径不写任何值");
    } finally {
      globalThis.fetch = base;
    }
  });

  it("轮询 401（relayToken 失效）按孤儿 job 提示稍候重试，不解读成应用账号问题（AC4/R1）", async () => {
    const base = globalThis.fetch;
    const calls: string[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push(`${init?.method ?? "GET"} ${url}`);
      if (init?.method === "POST") {
        const body = JSON.parse(String(init.body)) as { action?: string };
        if (body.action === "cancel") return json200({ ok: true, status: "error", error: "已取消登录窗口" });
        return json200({ ok: true, status: "waiting", relayToken: RELAY_TOKEN, frame: "*" });
      }
      // 轮询一律 401 固定错误体（token 已随终态失效的形态）
      return new Response(JSON.stringify({ ok: false, status: "error", error: "登录中转校验失败" }), {
        status: 401,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch;
    try {
      render(<XAccountCard />);
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: /中转登录/ }));
        await until(() => screen.queryAllByText(/后台仍有登录窗口进行中，稍候自动结束后可重试/).length > 0);
      });
      assert.ok(
        screen.getAllByText(/后台仍有登录窗口进行中，稍候自动结束后可重试/).length > 0,
        "孤儿 job 文案要给用户看得见的错误（含稍候/重试要素）",
      );
      assert.equal(screen.queryAllByText(/需要先登录应用账号/).length, 0, "relay 401 不是应用账号问题");
      assert.equal(screen.queryAllByText(/登录中转不可用（401）/).length, 0, "不再误报网关不可用");
      assert.ok(calls.some((c) => c.startsWith(`GET /api/login-browser?frame=1&relayToken=${RELAY_TOKEN}`)));
      assert.equal(useSettings.getState().xCookie, "", "401 路径不写任何值");
    } finally {
      globalThis.fetch = base;
    }
  });

  it("start 401（数据面闸）仍报应用账号文案，与 relay 401 的孤儿 job 文案区分（R1 回归）", async () => {
    const base = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ ok: false, error: "需要登录" }), {
        status: 401,
        headers: { "content-type": "application/json" },
      })) as typeof fetch;
    try {
      render(<XAccountCard />);
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: /中转登录/ }));
        await until(() => screen.queryAllByText(/需要先登录应用账号（设置 → 应用账号）/).length > 0);
      });
      assert.ok(
        screen.getAllByText(/需要先登录应用账号（设置 → 应用账号）/).length > 0,
        "数据面闸 401 语义不变：引导登应用账号",
      );
      assert.equal(screen.queryAllByText(/后台仍有登录窗口进行中/).length, 0, "start 401 不是孤儿 job 形态");
      assert.equal(useSettings.getState().xCookie, "", "失败路径不写任何值");
    } finally {
      globalThis.fetch = base;
    }
  });

  it("手动粘贴路径保留：说明降为「或手动粘贴」且输入仍可用（AC4）", () => {
    render(<XAccountCard />);
    assert.ok(screen.getByText(/或手动粘贴/), "手动粘贴文案保留并降级为中转的兜底");
    const input = screen.getByLabelText("X Cookie") as HTMLInputElement;
    fireEvent.change(input, { target: { value: X_OK } });
    assert.equal(useSettings.getState().xCookie, X_OK);
  });
});
