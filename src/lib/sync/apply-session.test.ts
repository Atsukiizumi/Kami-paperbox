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
