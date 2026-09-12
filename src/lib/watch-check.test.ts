import assert from "node:assert/strict";
import { test } from "node:test";
import { checkWatchArtists, totalNew, type WatchCheckResult } from "./watch-check.ts";
import type { WatchArtist } from "./watch.ts";
import type { fetchSource } from "./source.ts";

const artists: WatchArtist[] = [
  { source: "pixiv", id: "1", name: "A", avatar: "", addedAt: 1, lastSeenId: "100" },
  { source: "pixiv", id: "2", name: "B", avatar: "", addedAt: 2 },
  { source: "fanbox", id: "c1", name: "C", avatar: "", addedAt: 3, lastSeenId: "p2" },
];

type FetchImpl = typeof fetchSource;
function fakeFetch(responses: Record<string, unknown>) {
  let calls = 0;
  const impl = async ({ data }: { data: { op: string; id?: string } }) => {
    calls += 1;
    const res = responses[`${data.op}:${data.id ?? ""}`];
    if (!res) throw new Error("上游失败");
    return res;
  };
  return { impl: impl as unknown as FetchImpl, getCalls: () => calls };
}

test("逐画师检查：水位计数、失败隔离、fanbox 通道", async () => {
  const { impl } = fakeFetch({
    "pixivUser:1": {
      op: "pixivUser",
      items: [{ id: "103" }, { id: "102" }, { id: "100" }], // 2 条新
      newestId: "103",
    },
    "pixivUser:2": {
      op: "pixivUser",
      items: [{ id: "9" }], // 无水位 → 0
    },
    "fanboxCreator:c1": {
      op: "fanboxCreator",
      items: [{ id: "p5" }, { id: "p4" }, { id: "p3" }], // 水位 p2 不在页内 → 保守 0
    },
  });
  const results = (await checkWatchArtists(artists, {}, { fetchImpl: impl })) as WatchCheckResult[];
  assert.deepEqual(
    results.map((r) => [r.id, r.newCount, r.newestId, r.error]),
    [
      ["1", 2, "103", undefined],
      ["2", 0, "9", undefined],
      ["c1", 0, "p5", undefined],
    ],
  );
  assert.equal(results[2]!.latestThumb, ""); // 无 thumb 字段 → 空串
  assert.equal(totalNew(results), 2);
});

test("单画师失败不连坐；totalNew 忽略失败者", async () => {
  const { impl } = fakeFetch({
    "pixivUser:1": {
      op: "pixivUser",
      items: [{ id: "105" }],
      newestId: "105",
    },
  });
  const results = (await checkWatchArtists(artists, {}, { fetchImpl: impl })) as WatchCheckResult[];
  assert.equal(results[0]!.newCount, 0); // 无水位
  assert.match(results[1]!.error ?? "", /上游失败/);
  assert.match(results[2]!.error ?? "", /上游失败/);
  assert.equal(totalNew(results), 0);
});

test("并发 2：N 个画师最多同时 2 个在飞", async () => {
  let inFlight = 0;
  let peak = 0;
  const rawImpl = async () => {
    inFlight += 1;
    peak = Math.max(peak, inFlight);
    await new Promise((r) => setTimeout(r, 5));
    inFlight -= 1;
    return { op: "pixivUser", items: [], newestId: "x" };
  };
  const many: WatchArtist[] = Array.from({ length: 6 }, (_, i) => ({
    source: "pixiv",
    id: String(i),
    name: "x",
    avatar: "",
    addedAt: i,
    lastSeenId: "x",
  }));
  await checkWatchArtists(many, {}, { fetchImpl: rawImpl as unknown as FetchImpl, concurrency: 2 });
  assert.ok(peak <= 2, `peak=${peak}`);
});
