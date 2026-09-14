/**
 * refreshIdentities 失败提示回归（SWALLOW）。
 *
 * 作用：锁住「whoami 非 200 / 网络异常必须弹用户可见 toast（固定 id）」与
 *       「成功路径零 toast、照常回填身份」两条线。
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { toast } from "sonner";
import { IDENTITY_REFRESH_TOAST_ID, useSettings } from "./store.ts";

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

function resetStore() {
  useSettings.setState({
    pixivCookie: "",
    fanboxCookie: "",
    accounts: [],
    activeAccountId: null,
  });
}

test("whoami 非 200 时弹固定 id 的失败提示，不回填身份", async () => {
  const stub = stubToastErrors();
  const fetchOriginal = globalThis.fetch;
  globalThis.fetch = (async () => new Response("{}", { status: 401 })) as typeof fetch;
  resetStore();
  useSettings.setState({ pixivCookie: PIXIV_SESSION });
  try {
    await useSettings.getState().refreshIdentities();
  } finally {
    globalThis.fetch = fetchOriginal;
    resetStore();
    stub.restore();
  }
  assert.equal(stub.calls.length, 1, "失败必须提示一次");
  assert.match(String(stub.calls[0]?.message), /站点身份获取失败/);
  assert.equal(stub.calls[0]?.options?.id, IDENTITY_REFRESH_TOAST_ID, "固定 id 防刷屏");
});

test("whoami 网络异常时弹固定 id 的失败提示", async () => {
  const stub = stubToastErrors();
  const fetchOriginal = globalThis.fetch;
  globalThis.fetch = (async () => {
    throw new TypeError("fetch failed");
  }) as typeof fetch;
  resetStore();
  useSettings.setState({ pixivCookie: PIXIV_SESSION });
  try {
    await useSettings.getState().refreshIdentities();
  } finally {
    globalThis.fetch = fetchOriginal;
    resetStore();
    stub.restore();
  }
  assert.equal(stub.calls.length, 1, "网络异常也必须提示，不再静默吞掉");
  assert.equal(stub.calls[0]?.options?.id, IDENTITY_REFRESH_TOAST_ID, "固定 id 防刷屏");
});

test("whoami 200 时不弹提示，身份照常回填", async () => {
  const stub = stubToastErrors();
  const fetchOriginal = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ pixiv: { id: "12345678", name: "墨纸" }, fanbox: null }), {
      status: 200,
      headers: { "content-type": "application/json" },
    })) as typeof fetch;
  resetStore();
  const accId = useSettings.getState().addAccount("测试");
  useSettings.setState({ pixivCookie: PIXIV_SESSION });
  try {
    await useSettings.getState().refreshIdentities();
    const account = useSettings.getState().accounts.find((a) => a.id === accId);
    assert.equal(useSettings.getState().activeAccountId, accId, "当前账号不漂移");
    assert.equal(account?.pixivProfile?.name, "墨纸", "回填的身份应落在当前账号上");
  } finally {
    globalThis.fetch = fetchOriginal;
    resetStore();
    stub.restore();
  }
  assert.deepEqual(stub.calls, [], "成功路径必须保持静默");
});
