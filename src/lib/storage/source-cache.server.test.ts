import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { FetchInput, FetchOk } from "../types.ts";
import {
  cachedDispatchFetch,
  sourceCacheKey,
  readSourceCache,
  writeSourceCache,
} from "./source-cache.server.ts";

function ranking(over: Partial<{ cookie: string; page: number; date: string }> = {}): FetchInput {
  return {
    op: "pixivRanking",
    mode: "daily",
    page: over.page ?? 1,
    date: over.date ?? "20260907",
    pixivCookie: over.cookie,
    safeMode: true,
    hideAi: false,
  };
}

test("sourceCacheKey ignores cookie token and request host", () => {
  const a = sourceCacheKey(ranking({ cookie: "11111111_aaaaaaaa" }));
  const b = sourceCacheKey(ranking({ cookie: "11111111_bbbbbbbb" }));
  const other = sourceCacheKey(ranking({ cookie: "22222222_aaaaaaaa" }));
  const guest = sourceCacheKey(ranking({ cookie: "" }));
  assert.ok(a);
  assert.equal(a, b);
  assert.notEqual(a, other);
  assert.notEqual(a, guest);
  assert.notEqual(sourceCacheKey(ranking({ page: 2 })), a);
});

test("recommend, following and FANBOX cache by account id", () => {
  const recA = sourceCacheKey({ op: "pixivRecommend", pixivCookie: "11111111_aaaaaaaa" });
  const recB = sourceCacheKey({ op: "pixivRecommend", pixivCookie: "11111111_bbbbbbbb" });
  const recOther = sourceCacheKey({ op: "pixivRecommend", pixivCookie: "22222222_aaaaaaaa" });
  assert.ok(recA);
  assert.equal(recA, recB);
  assert.notEqual(recA, recOther);
  assert.ok(sourceCacheKey({ op: "pixivFollowing", page: 1, pixivCookie: "11111111_aaaaaaaa" }));
  assert.ok(sourceCacheKey({ op: "fanboxHome", fanboxCookie: "11111111_aaaaaaaa" }));
  assert.ok(sourceCacheKey({ op: "fanboxSupporting", fanboxCookie: "11111111_aaaaaaaa" }));
  assert.ok(sourceCacheKey({ op: "fanboxCreator", id: "official" }));
  assert.equal(sourceCacheKey({ op: "fanboxPost", id: "1", fanboxCookie: "11111111_aaaaaaaa" }), null);
  assert.equal(sourceCacheKey({ op: "pixivIllust", id: "1" }), null);
});

test("FANBOX list keys include hideAi (TD-36: 参数集与 pixiv 系对齐)", () => {
  for (const op of ["fanboxHome", "fanboxSupporting"] as const) {
    const off = sourceCacheKey({ op, fanboxCookie: "11111111_aaaaaaaa", hideAi: false });
    const on = sourceCacheKey({ op, fanboxCookie: "11111111_aaaaaaaa", hideAi: true });
    assert.ok(off && on);
    assert.notEqual(off, on);
  }
  const creatorOff = sourceCacheKey({ op: "fanboxCreator", id: "official", hideAi: false });
  const creatorOn = sourceCacheKey({ op: "fanboxCreator", id: "official", hideAi: true });
  assert.notEqual(creatorOff, creatorOn);
  const taggedOff = sourceCacheKey({ op: "fanboxTagged", tag: "t", page: 1, hideAi: false });
  const taggedOn = sourceCacheKey({ op: "fanboxTagged", tag: "t", page: 1, hideAi: true });
  assert.notEqual(taggedOff, taggedOn);
});

test("pixivUser caches by id/offset (PER-9: 大画师翻页不重复全量回源)", () => {
  const a = sourceCacheKey({ op: "pixivUser", id: "123", offset: 0, pixivCookie: "11111111_aaaaaaaa" });
  const aAgain = sourceCacheKey({ op: "pixivUser", id: "123", offset: 0, pixivCookie: "11111111_bbbbbbbb" });
  const page2 = sourceCacheKey({ op: "pixivUser", id: "123", offset: 30, pixivCookie: "11111111_aaaaaaaa" });
  const other = sourceCacheKey({ op: "pixivUser", id: "456", offset: 0, pixivCookie: "11111111_aaaaaaaa" });
  assert.ok(a);
  assert.equal(a, aAgain); // 同账号翻回同页命中
  assert.notEqual(a, page2);
  assert.notEqual(a, other);
});

test("cachedDispatchFetch reuses a ranking payload without calling fetch again", async () => {
  const root = mkdtempSync(join(tmpdir(), "kami-source-"));
  try {
    let calls = 0;
    const payload = { op: "pixivRanking", date: "20260907", items: [], nextPage: null } as FetchOk;
    const fetchImpl = async () => {
      calls += 1;
      return payload;
    };
    const first = await cachedDispatchFetch(ranking({ cookie: "11111111_aaaaaaaa" }), fetchImpl, root);
    const second = await cachedDispatchFetch(ranking({ cookie: "11111111_bbbbbbbb" }), fetchImpl, root);
    assert.equal(calls, 1);
    assert.equal(first, payload);
    assert.deepEqual(second, payload);
    await cachedDispatchFetch(ranking({ cookie: "22222222_aaaaaaaa" }), fetchImpl, root);
    assert.equal(calls, 2);
    const stored = readSourceCache(sourceCacheKey(ranking({ cookie: "11111111_aaaaaaaa" }))!, root);
    assert.ok(stored);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("cachedDispatchFetch reuses recommend, following and FANBOX for the same account", async () => {
  const root = mkdtempSync(join(tmpdir(), "kami-source-"));
  try {
    const cases: { input: FetchInput; rotated: FetchInput; other: FetchInput; payload: FetchOk }[] = [
      {
        input: { op: "pixivRecommend", pixivCookie: "11111111_aaaaaaaa" },
        rotated: { op: "pixivRecommend", pixivCookie: "11111111_bbbbbbbb" },
        other: { op: "pixivRecommend", pixivCookie: "22222222_aaaaaaaa" },
        payload: { op: "pixivRecommend", items: [], nextPage: null },
      },
      {
        input: { op: "pixivFollowing", page: 1, pixivCookie: "11111111_aaaaaaaa" },
        rotated: { op: "pixivFollowing", page: 1, pixivCookie: "11111111_bbbbbbbb" },
        other: { op: "pixivFollowing", page: 1, pixivCookie: "22222222_aaaaaaaa" },
        payload: { op: "pixivFollowing", items: [], nextPage: null },
      },
      {
        input: { op: "fanboxHome", fanboxCookie: "11111111_aaaaaaaa" },
        rotated: { op: "fanboxHome", fanboxCookie: "11111111_bbbbbbbb" },
        other: { op: "fanboxHome", fanboxCookie: "22222222_aaaaaaaa" },
        payload: { op: "fanboxHome", items: [], cursor: null },
      },
    ];
    for (const c of cases) {
      let calls = 0;
      const fetchImpl = async () => {
        calls += 1;
        return c.payload;
      };
      const first = await cachedDispatchFetch(c.input, fetchImpl, root);
      const second = await cachedDispatchFetch(c.rotated, fetchImpl, root);
      assert.equal(calls, 1, c.input.op);
      assert.equal(first, c.payload);
      assert.deepEqual(second, c.payload);
      await cachedDispatchFetch(c.other, fetchImpl, root);
      assert.equal(calls, 2, `${c.input.op} other account`);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("sourceCacheKey ignores fresh flag", () => {
  const a = sourceCacheKey(ranking({ cookie: "11111111_aaaaaaaa" }));
  const b = sourceCacheKey({ ...ranking({ cookie: "11111111_aaaaaaaa" }), fresh: true });
  assert.equal(a, b);
});

test("cachedDispatchFetch fresh skips disk and overwrites", async () => {
  const root = mkdtempSync(join(tmpdir(), "kami-source-"));
  try {
    let calls = 0;
    const first = { op: "pixivRanking", date: "20260907", items: [{ id: "1" }], nextPage: null } as FetchOk;
    const second = { op: "pixivRanking", date: "20260907", items: [{ id: "2" }], nextPage: null } as FetchOk;
    const fetchImpl = async () => {
      calls += 1;
      return calls === 1 ? first : second;
    };
    const input = ranking({ cookie: "11111111_aaaaaaaa" });
    await cachedDispatchFetch(input, fetchImpl, root);
    const cached = await cachedDispatchFetch(input, fetchImpl, root);
    assert.equal(calls, 1);
    assert.deepEqual(cached, first);
    const forced = await cachedDispatchFetch({ ...input, fresh: true }, fetchImpl, root);
    assert.equal(calls, 2);
    assert.deepEqual(forced, second);
    const stored = readSourceCache(sourceCacheKey(input)!, root);
    assert.deepEqual(stored, second);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("writeSourceCache expires after ttl", () => {
  const root = mkdtempSync(join(tmpdir(), "kami-source-"));
  try {
    const key = "abc";
    writeSourceCache(key, { op: "pixivRanking", items: [] } as unknown as FetchOk, root, { now: 1_000 });
    assert.equal(readSourceCache(key, root, { now: 1_000 + 40 * 60_000 }), null);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
