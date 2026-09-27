/**
 * AccountSyncBridge 静默窗补推回归（P2-a，design §2.4）。
 *
 * 作用：锁「窗内防抖到点不丢 → 窗外 +100ms 补推且恰一次」「窗口已过直接推
 *      （无补推层）」「窗内连续改动由同 key 覆盖收敛成一次 POST」三条。
 * 环境垫片：../../test/dom.ts 必须最先引入；node 假时钟（setTimeout/Date，
 *      bridge 的 timer 已裸化可拦）+ fetch 桩 + 最小 indexedDB 桩。
 * 关键顺序：better-auth 的 createAuthClient()（client.ts 顶层求值）把当时的
 *      全局 fetch 捕获为 customFetchImpl（@better-fetch getFetch 首选它）——
 *      桩必须在模块顶层先装，bridge 经 before() 动态导入，晚于桩。
 * 为什么：窗内丢推是数据可靠性缺口（PRD P2-a），AC 要求「补推且只补一次」。
 */
import "../test/dom.ts";
import assert from "node:assert/strict";
import { before, beforeEach, describe, it, type TestContext } from "node:test";
import { act, cleanup, render } from "@testing-library/react";
import { useSettings } from "@/lib/store";
import type { AccountSyncBridge as AccountSyncBridgeComponent } from "./account-sync-bridge.tsx";

// ── fetch 桩 ────────────────────────────────────────────────────────────────

type Deferred = { promise: Promise<Response>; resolve: (r: Response) => void };

function makeDeferred(): Deferred {
  let resolve!: (r: Response) => void;
  const promise = new Promise<Response>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

/** POST /api/account/sync 计数——只认 POST，collectBackup 的 GET 不误计。 */
let postCount = 0;
/**
 * GET /api/account/sync 的受控 deferred：非 null 时挂起不 resolve，把前置 5s
 * 静默窗钉死在 t0+5000（bridge 拉取初值）；null 时回 401，pullAccountSync
 * 短路返回 applied=[]，拉取尾声把窗口推过（now+0）。
 */
let syncGet: Deferred | null = null;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

async function stubFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (url.includes("/api/auth/get-session")) {
    // Better Auth useSession 的会话源：use-current-user.ts 只消费 data.user
    return jsonResponse({
      user: { id: "u-test", name: "Tester", email: "tester@example.com", image: null },
      session: { id: "sess-test", userId: "u-test" },
    });
  }
  if (url.includes("/api/account/sync")) {
    if ((init?.method ?? "GET") === "POST") {
      postCount += 1;
      return jsonResponse({ ok: true });
    }
    if (syncGet) return syncGet.promise;
    return new Response("unauthorized", { status: 401 });
  }
  // /api/vault（listServerVault）、/api/proxy（readProxyUrl）在源码里自带
  // catch 降级（design §2.4），404 不会炸 push 链路
  return new Response("not found", { status: 404 });
}

// ── 最小 IndexedDB 桩（~30 行）：只撑 collectBackup → listVault() 的
//    open → transaction → objectStore → getAll 链，微任务置回调（design §2.4）。

function installIndexedDBStub(): void {
  const db = {
    objectStoreNames: { contains: () => true },
    close() {},
    transaction() {
      const fire = (req: { result?: unknown; onsuccess?: (() => void) | null }, result: unknown) => {
        queueMicrotask(() => {
          req.result = result;
          req.onsuccess?.();
        });
      };
      return {
        objectStore() {
          const readReq = (result: unknown) => {
            const req: { result?: unknown; onsuccess?: (() => void) | null; onerror?: (() => void) | null } = {};
            fire(req, result);
            return req;
          };
          return {
            getAll: () => readReq([]),
            get: () => readReq(undefined),
            put: () => ({}),
          };
        },
        oncomplete: null,
        onerror: null,
      };
    },
  };
  (globalThis as { indexedDB?: unknown }).indexedDB = {
    open: () => {
      const req: { result?: unknown; onsuccess?: (() => void) | null; onerror?: (() => void) | null } = {};
      queueMicrotask(() => {
        req.result = db;
        req.onsuccess?.();
      });
      return req;
    },
  };
}

// 桩先于 bridge 导入链就位（见文件头「关键顺序」）；bridge 组件经 before() 注入
globalThis.fetch = stubFetch as typeof fetch;

/** 桥接组件：before() 里动态导入（晚于 fetch 桩捕获点）。 */
let Bridge!: typeof AccountSyncBridgeComponent;

// ── 驱动 ────────────────────────────────────────────────────────────────────

/** setImmediate 未被假时钟接管：一轮排空一层微任务/回调链（桩 fetch 链数轮够）。 */
async function flush(rounds = 8): Promise<void> {
  for (let i = 0; i < rounds; i += 1) {
    await new Promise<void>((r) => setImmediate(r));
  }
}

/**
 * 挂载并等会话解析完成。better-auth session-atom 的 mount 取数走
 * setTimeout(0)（被假时钟接管），先 tick(1) 触发、再 flush 推进 promise 链。
 * 返回时 pull effect 已跑过：前置 5s 窗已按 syncGet 形态钉死或推过。
 */
async function mountSignedIn(t: TestContext): Promise<void> {
  render(<Bridge />);
  act(() => {
    t.mock.timers.tick(1);
  });
  await act(async () => {
    await flush();
  });
}

describe("AccountSyncBridge 静默窗补推（P2-a）", () => {
  before(async () => {
    ({ AccountSyncBridge: Bridge } = await import("./account-sync-bridge.tsx"));
  });

  beforeEach(() => {
    cleanup();
    localStorage.clear();
    postCount = 0;
    syncGet = null;
    installIndexedDBStub();
    useSettings.setState({ hideAi: false });
  });

  it("窗内到点不丢：排到窗外 +100ms 补推且只补一次", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
    syncGet = makeDeferred(); // GET 挂起 → 窗口钉死在 t0+5000
    await mountSignedIn(t);

    act(() => {
      useSettings.setState({ hideAi: true }); // 触发 settings 段防抖（4s）
    });
    act(() => {
      t.mock.timers.tick(4000); // 防抖到点，仍在窗内（t0+4000 < t0+5000）
    });
    assert.equal(postCount, 0, "窗内到点不推，改排补推");

    await act(async () => {
      t.mock.timers.tick(1100); // 补推落点 = wait(1000) + 100ms，已在窗外
      await flush();
    });
    assert.equal(postCount, 1, "窗外 +100ms 补推恰一次");

    await act(async () => {
      t.mock.timers.tick(5000);
      await flush();
    });
    assert.equal(postCount, 1, "补推体内不判窗不续期，不再多推");
  });

  it("窗口已过（拉取 401 推过窗口）防抖到点直接推，无补推层", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
    await mountSignedIn(t); // syncGet=null → 401 短路 → suppressUntil = now+0

    act(() => {
      useSettings.setState({ hideAi: true });
    });
    await act(async () => {
      t.mock.timers.tick(4000); // 防抖到点：wait ≤ 0 → 直接推
      await flush();
    });
    assert.equal(postCount, 1, "窗外直接推一次");

    await act(async () => {
      t.mock.timers.tick(5000);
      await flush();
    });
    assert.equal(postCount, 1, "没有补推层，不二次推");
  });

  it("窗内连续两次改动：第二次清掉第一次的补推定时器，最终恰一次", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
    syncGet = makeDeferred();
    await mountSignedIn(t);

    act(() => {
      useSettings.setState({ hideAi: true }); // 改动一
    });
    act(() => {
      t.mock.timers.tick(4000); // 防抖一到点（窗内）→ 补推定时器入表（t0+5100）
    });
    assert.equal(postCount, 0);

    act(() => {
      useSettings.setState({ hideAi: false }); // 改动二：clearTimeout 掉补推定时器，重设防抖
    });
    await act(async () => {
      t.mock.timers.tick(4000); // 防抖二到点（t0+8000，窗外）→ 直接推
      await flush();
    });
    assert.equal(postCount, 1, "同 key 覆盖：补推被清，只有最后一次改动收尾");

    await act(async () => {
      t.mock.timers.tick(5000);
      await flush();
    });
    assert.equal(postCount, 1, "不叠罗汉，最终恰一次");
  });
});
