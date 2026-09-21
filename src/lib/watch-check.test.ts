import assert from "node:assert/strict";
import { test } from "node:test";
import { checkWatchArtists, checkWatchTags, totalNew, type WatchCheckResult } from "./watch-check.ts";
import type { WatchArtist, WatchTag } from "./watch.ts";
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
  const results = (await checkWatchArtists(artists, () => ({}), { fetchImpl: impl })) as WatchCheckResult[];
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
  const results = (await checkWatchArtists(artists, () => ({}), { fetchImpl: impl })) as WatchCheckResult[];
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
  await checkWatchArtists(many, () => ({}), { fetchImpl: rawImpl as unknown as FetchImpl, concurrency: 2 });
  assert.ok(peak <= 2, `peak=${peak}`);
});

// ── 标签订阅检查（09-21-tag-watch-vault-filter）──────────────────────────────

test("逐标签检查：pixiv 走搜索最新序、booru 走 recent+tags、水位计数、失败隔离", async () => {
  const tags: WatchTag[] = [
    { source: "pixiv", tag: "鳴潮", addedAt: 1, lastSeenId: "100" },
    { source: "yande", tag: "nagi", addedAt: 2, lastSeenId: "5" },
    { source: "konachan", tag: "snow", addedAt: 3 }, // 无水位 → 0
    { source: "danbooru", tag: "gone", addedAt: 4, lastSeenId: "1" }, // 上游失败 → 隔离
  ];
  const calls: string[] = [];
  const impl = (async ({ data }: { data: { op: string; word?: string; tags?: string; site?: string } }) => {
    calls.push(`${data.op}:${data.word ?? data.tags ?? data.site}`);
    if (data.op === "pixivSearch" && data.word === "鳴潮") {
      return { op: "pixivSearch", items: [{ id: "103", thumb: "a.jpg" }, { id: "101" }, { id: "100" }], nextPage: null };
    }
    if (data.op === "booruList" && data.site === "yande") {
      return { op: "booruList", site: "yande", items: [{ id: "9" }, { id: "5" }], nextPage: null };
    }
    if (data.op === "booruList" && data.site === "konachan") {
      return { op: "booruList", site: "konachan", items: [{ id: "3" }], nextPage: null };
    }
    throw new Error("上游失败");
  }) as unknown as FetchImpl;
  const results = await checkWatchTags(tags, () => ({}), { fetchImpl: impl });
  assert.deepEqual(
    results.map((r) => [r.tag, r.newCount, r.newestId, r.error === undefined]),
    [
      ["鳴潮", 2, "103", true],
      ["nagi", 1, "9", true],
      ["snow", 0, "3", true],
      ["gone", 0, undefined, false],
    ],
  );
  assert.equal(results[0]?.latestThumb, "a.jpg");
  // pixiv 请求带 date_d 排序 + booru 用 recent 流
  assert.ok(calls.includes("pixivSearch:鳴潮"));
  assert.ok(calls.includes("booruList:nagi"));
});
