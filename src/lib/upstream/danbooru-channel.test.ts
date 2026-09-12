import assert from "node:assert/strict";
import { test } from "node:test";
import { danbooruChannel, danbooruJsonWithChannels, type DanbooruChannels } from "./booru-sites.ts";

function channels(
  pool: { ok?: boolean; body?: string; throwErr?: boolean },
  curl: { status?: number; body?: string },
): { impl: DanbooruChannels; poolCalls: () => number; curlCalls: () => number } {
  const state = { poolCalls: 0, curlCalls: 0 };
  return {
    poolCalls: () => state.poolCalls,
    curlCalls: () => state.curlCalls,
    impl: {
      poolFetch: async () => {
        state.poolCalls += 1;
        if (pool.throwErr) throw new Error("pool down");
        return {
          ok: pool.ok ?? true,
          text: async () => pool.body ?? "[]",
        };
      },
      curlFetch: async () => {
        state.curlCalls += 1;
        return { status: curl.status ?? 200, body: Buffer.from(curl.body ?? "[]", "utf8") };
      },
    },
  };
}

test("PER-10: pool 2xx JSON 命中时不再起 curl", async () => {
  const ch = channels({ ok: true, body: '[{"id":1}]' }, {});
  const out = await danbooruJsonWithChannels("https://danbooru.donmai.us/posts.json", {}, ch.impl);
  assert.deepEqual(out, [{ id: 1 }]);
  assert.equal(ch.poolCalls(), 1);
  assert.equal(ch.curlCalls(), 0);
});

test("PER-10: 池通道拿到挑战页 HTML 时降级 curl", async () => {
  const ch = channels({ ok: true, body: "<html>challenge</html>" }, { body: '[{"id":2}]' });
  const out = await danbooruJsonWithChannels("https://danbooru.donmai.us/posts.json", {}, ch.impl);
  assert.deepEqual(out, [{ id: 2 }]);
  assert.equal(ch.curlCalls(), 1);
});

test("PER-10: 池通道网络失败 / 非 2xx 都降级 curl；curl 非 2xx 抛 UpstreamError", async () => {
  for (const pool of [{ throwErr: true }, { ok: false, body: "" }]) {
    const ch = channels(pool, { body: "[]" });
    await danbooruJsonWithChannels("u", {}, ch.impl);
    assert.equal(ch.curlCalls(), 1);
  }
  const bad = channels({ throwErr: true }, { status: 403, body: "" });
  await assert.rejects(
    danbooruJsonWithChannels("u", {}, bad.impl),
    /Danbooru 请求失败（403）/,
  );
});

test("PER-10: 通道计数同步推进", async () => {
  const before = { ...danbooruChannel };
  const ok = channels({ ok: true, body: "[]" }, {});
  await danbooruJsonWithChannels("u", {}, ok.impl);
  assert.equal(danbooruChannel.poolOk, before.poolOk + 1);
  const fb = channels({ ok: true, body: "<x>" }, { body: "[]" });
  await danbooruJsonWithChannels("u", {}, fb.impl);
  assert.equal(danbooruChannel.poolFallback, before.poolFallback + 1);
});
