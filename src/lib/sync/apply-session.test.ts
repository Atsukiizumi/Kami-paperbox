/**
 * apply-session 吞错尾部提示回归（SWALLOW）。
 *
 * 作用：锁住「syncSessions 失败必须弹固定 id 的 toast；refreshIdentities 的
 *       失败提示由 store 内部负责（本层只静默兜底不重复）；成功路径零 toast」，
 *       动作以替身注入、不触网。
 * 注意：setPixivCookie 自带一次 void syncSessions() 预调用（store 既有行为），
 *       替身按调用序计数，只让被测尾部那次拒绝。
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { toast } from "sonner";
import { applyLoginSession } from "./apply-session.ts";
import { useSettings } from "../store.ts";

type ErrCall = { message: unknown; options: { id?: string } | undefined };

function stubToastErrors() {
  const calls: ErrCall[] = [];
  const original = toast.error;
  toast.error = ((message: unknown, options?: { id?: string }) => {
    calls.push({ message, options });
    return undefined as unknown as string | number;
  }) as typeof toast.error;
  return {
    calls,
    restore() {
      toast.error = original;
    },
  };
}

const PIXIV_SESSION = "12345678_ABCDEFGH";
const PROFILE = { id: "12345678", name: "墨纸" };

function stubActions(stubs: { refreshIdentities?: () => Promise<void>; syncSessions?: () => Promise<void> }) {
  const original = {
    refreshIdentities: useSettings.getState().refreshIdentities,
    syncSessions: useSettings.getState().syncSessions,
  };
  useSettings.setState(stubs);
  return () => useSettings.setState(original);
}

test("syncSessions 失败时弹固定 id 提示，登录流程仍返回 ok", async () => {
  const stub = stubToastErrors();
  let syncCalls = 0;
  const restoreActions = stubActions({
    refreshIdentities: async () => undefined,
    syncSessions: async () => {
      syncCalls += 1;
      if (syncCalls === 2) throw new Error("会话写入失败（500）"); // 第 2 次 = 被测尾部
    },
  });
  try {
    const result = await applyLoginSession({ pixiv: PIXIV_SESSION, pixivProfile: PROFILE });
    assert.deepEqual(result, { ok: true }, "失败已提示，不再向上抛");
  } finally {
    restoreActions();
    stub.restore();
  }
  assert.equal(stub.calls.length, 1);
  assert.match(String(stub.calls[0]?.message), /登录状态同步失败/);
  assert.equal(stub.calls[0]?.options?.id, "kami-session-sync");
});

test("refreshIdentities 拒绝时不重复提示（提示由 store 内部负责），流程不崩", async () => {
  const stub = stubToastErrors();
  const restoreActions = stubActions({
    refreshIdentities: async () => {
      throw new Error("network down");
    },
    syncSessions: async () => undefined,
  });
  try {
    await applyLoginSession({ pixiv: PIXIV_SESSION });
  } finally {
    restoreActions();
    stub.restore();
  }
  assert.deepEqual(stub.calls, [], "本层静默兜底，避免同一失败双重弹提示");
});

test("全链路成功时不弹任何提示", async () => {
  const stub = stubToastErrors();
  const restoreActions = stubActions({
    refreshIdentities: async () => undefined,
    syncSessions: async () => undefined,
  });
  try {
    const result = await applyLoginSession({ pixiv: PIXIV_SESSION, pixivProfile: PROFILE });
    assert.deepEqual(result, { ok: true });
  } finally {
    restoreActions();
    stub.restore();
  }
  assert.deepEqual(stub.calls, [], "成功路径必须保持静默");
});

// ── X 登录中转写入（AC3/AC5）：x 恒为 sanitize 规范形；未传 x 零触碰 ──────────

const X_TOKEN = "t".repeat(40);
const X_CT0 = "c".repeat(40);

test("applyLoginSession({x}) 写 store，噪声字段被双保险清洗成规范形", async () => {
  const stub = stubToastErrors();
  const restoreActions = stubActions({
    refreshIdentities: async () => undefined,
    syncSessions: async () => undefined,
  });
  const snap = {
    xCookie: useSettings.getState().xCookie,
    accounts: useSettings.getState().accounts,
    activeAccountId: useSettings.getState().activeAccountId,
  };
  useSettings.setState({ xCookie: "" });
  try {
    const result = await applyLoginSession({
      x: `guest_id=n1; auth_token=${X_TOKEN}; ct0=${X_CT0}; twid=u%3D1`,
    });
    assert.deepEqual(result, { ok: true });
    assert.equal(
      useSettings.getState().xCookie,
      `auth_token=${X_TOKEN}; ct0=${X_CT0}`,
      "入库必须是 sanitizeXCookie 规范形态（中转产物本已规范，这里锁双保险）",
    );
  } finally {
    useSettings.setState({ xCookie: snap.xCookie, accounts: snap.accounts, activeAccountId: snap.activeAccountId });
    restoreActions();
    stub.restore();
  }
});

test("不合规 x（缺 ct0）不写入也不清空既有 X 会话", async () => {
  const stub = stubToastErrors();
  const restoreActions = stubActions({
    refreshIdentities: async () => undefined,
    syncSessions: async () => undefined,
  });
  const snap = {
    xCookie: useSettings.getState().xCookie,
    accounts: useSettings.getState().accounts,
    activeAccountId: useSettings.getState().activeAccountId,
  };
  const existing = `auth_token=${X_TOKEN}; ct0=${X_CT0}`;
  useSettings.setState({ xCookie: existing });
  try {
    const result = await applyLoginSession({ x: `auth_token=${"z".repeat(40)}` });
    assert.deepEqual(result, { ok: true }, "X 无访客态校验：不合格串静默跳过，不失败");
    assert.equal(useSettings.getState().xCookie, existing, "既有 X 会话不被脏载荷清掉");
  } finally {
    useSettings.setState({ xCookie: snap.xCookie, accounts: snap.accounts, activeAccountId: snap.activeAccountId });
    restoreActions();
    stub.restore();
  }
});

test("未传 x：不触碰 X 会话（回归锁，行为与现状一致）", async () => {
  const stub = stubToastErrors();
  let xWrites = 0;
  const original = useSettings.getState().setXCookie;
  useSettings.setState({
    setXCookie: () => {
      xWrites += 1;
    },
  });
  const restoreActions = stubActions({
    refreshIdentities: async () => undefined,
    syncSessions: async () => undefined,
  });
  try {
    await applyLoginSession({ pixiv: PIXIV_SESSION, pixivProfile: PROFILE });
  } finally {
    useSettings.setState({ setXCookie: original });
    restoreActions();
    stub.restore();
  }
  assert.equal(xWrites, 0, "pixiv-only 登录不得触碰 X 会话");
});
