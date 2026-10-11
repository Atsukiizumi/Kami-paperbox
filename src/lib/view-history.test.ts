import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { WorkCard } from "./types.ts";
import {
  HISTORY_DAYS,
  historyEntryFromWork,
  historyToCard,
  parseAuthorHistory,
  parseHistoryItems,
  pruneHistory,
  resumePage,
  upsertAuthorHistory,
  upsertHistory,
  useViewHistory,
  type AuthorHistoryEntry,
  type HistoryEntry,
} from "./view-history.ts";

function entry(id: string, viewedAt = 1): HistoryEntry {
  return {
    source: "pixiv",
    id,
    title: id,
    author: "a",
    authorId: "1",
    thumb: "",
    pageCount: 1,
    viewedAt,
  };
}

function author(id: string, viewedAt = 1, extra: Partial<AuthorHistoryEntry> = {}): AuthorHistoryEntry {
  return { source: "pixiv", id, name: id, avatar: "", viewedAt, ...extra };
}

describe("view history", () => {
  it("moves a revisited work to the front", () => {
    const now = Date.now();
    const items = upsertHistory([entry("1", now - 2), entry("2", now - 1)], entry("1", now));
    assert.equal(items[0]?.id, "1");
    assert.equal(items[0]?.viewedAt, now);
    assert.equal(items.length, 2);
  });

  it("drops works older than the retention window", () => {
    const now = Date.now();
    const keep = entry("new", now);
    const drop = entry("old", now - (HISTORY_DAYS + 1) * 24 * 60 * 60_000);
    const items = pruneHistory([keep, drop], now);
    assert.deepEqual(items.map((row) => row.id), ["new"]);
  });

  it("drops broken persisted rows", () => {
    const items = parseHistoryItems([{ source: "pixiv", id: "1", title: "ok" }, { source: "nope", id: "2" }, null]);
    assert.equal(items.length, 1);
    assert.equal(items[0]?.title, "ok");
  });

  it("keeps an existing avatar when a later visit has none", () => {
    const first = upsertAuthorHistory([], author("9", 1, { name: "猫屋", avatar: "https://i.pximg.net/a.jpg" }));
    const next = upsertAuthorHistory(first, author("9", 2, { name: "猫屋", avatar: "" }));
    assert.equal(next[0]?.avatar, "https://i.pximg.net/a.jpg");
    assert.equal(next[0]?.viewedAt, 2);
  });

  it("keeps rating marks so a later veil can see them", () => {
    const work = {
      source: "pixiv",
      id: "7",
      title: "t",
      author: "a",
      authorId: "1",
      thumb: "",
      pageCount: 1,
      tags: ["原创", "AI生成"],
      aiType: 0,
      xRestrict: 1,
      rating: "",
    } as WorkCard;
    const row = historyEntryFromWork(work, 5);
    assert.equal(row.aiType, 0);
    assert.equal(row.xRestrict, 1);
    assert.equal(row.rating, "");
    assert.deepEqual(row.tags, ["AI生成"]);
    const card = historyToCard(row);
    assert.equal(card.xRestrict, 1);
    assert.equal(card.aiType, 0);
    assert.deepEqual(card.tags, ["AI生成"]);
  });

  it("parseHistoryItems keeps explicit 0 and only AI tags", () => {
    const [row] = parseHistoryItems([
      {
        source: "yande",
        id: "3",
        xRestrict: 0,
        aiType: 0,
        rating: "e",
        tags: ["原创", "novelai", 3],
      },
    ]);
    assert.equal(row?.xRestrict, 0);
    assert.equal(row?.aiType, 0);
    assert.equal(row?.rating, "e");
    assert.deepEqual(row?.tags, ["novelai"]);
    assert.equal(historyToCard(row!).rating, "e");
  });

  it("drops unknown author sources", () => {
    const items = parseAuthorHistory([{ source: "pixiv", id: "1", name: "a" }, { source: "yande", id: "2" }]);
    assert.equal(items.length, 1);
  });
});

// ── 续读水位 lastPage（10-11-wlm，M 数据层）──────────────────────────────────

describe("lastPage 水位", () => {
  it("parseHistoryItems 白名单带回 lastPage：合法带回、越界截进页内、显式 0 保留、脏值丢弃", () => {
    const [ok, clamped, zero] = parseHistoryItems([
      { source: "pixiv", id: "1", pageCount: 7, lastPage: 5 },
      { source: "pixiv", id: "2", pageCount: 3, lastPage: 9 },
      { source: "pixiv", id: "3", pageCount: 4, lastPage: 0 },
    ]);
    assert.equal(ok?.lastPage, 5);
    assert.equal(clamped?.lastPage, 2, "越界截到 pageCount−1");
    assert.equal(zero?.lastPage, 0, "停在首页也是水位，要留（同 aiType 0 口径）");
    const [float] = parseHistoryItems([{ source: "pixiv", id: "4", pageCount: 7, lastPage: 1.5 }]);
    const [negative] = parseHistoryItems([{ source: "pixiv", id: "5", pageCount: 7, lastPage: -1 }]);
    const [huge] = parseHistoryItems([{ source: "pixiv", id: "6", pageCount: 7, lastPage: 10_000 }]);
    const [absent] = parseHistoryItems([{ source: "pixiv", id: "7", pageCount: 7 }]);
    assert.deepEqual(
      [float?.lastPage, negative?.lastPage, huge?.lastPage, absent?.lastPage],
      [undefined, undefined, undefined, undefined],
      "小数/负数/超上限/缺席都当没写过",
    );
  });

  it("upsertHistory 结转同 key 旧水位：不冲掉、页数缩水 clamp、自带优先、不同 key 不结转", () => {
    const now = Date.now(); // viewedAt 必须新鲜，否则 90 天窗先把它 prune 掉
    const prev: HistoryEntry = { ...entry("1", now - 1000), pageCount: 7, lastPage: 5 };
    const reopened = { ...entry("1", now), pageCount: 7 };
    assert.equal(upsertHistory([prev], reopened)[0]?.lastPage, 5, "rememberView 重建条目不冲掉水位");
    assert.equal(
      upsertHistory([prev], { ...reopened, pageCount: 3 })[0]?.lastPage,
      2,
      "重开时页数缩水，clamp 到新 pageCount−1",
    );
    assert.equal(
      upsertHistory([prev], { ...reopened, lastPage: 1 })[0]?.lastPage,
      1,
      "新条目自带水位时优先用自带的",
    );
    assert.equal(
      upsertHistory([prev], { ...entry("2", now), pageCount: 7 })[0]?.lastPage,
      undefined,
      "不同 key 不结转",
    );
  });

  it("setLastPage 三态：有条目原位 patch + clamp、无条目 no-op、页码非法不动", () => {
    useViewHistory.setState({ items: [{ ...entry("1"), pageCount: 7 }] });
    useViewHistory.getState().setLastPage("pixiv", "1", 4);
    assert.equal(useViewHistory.getState().items[0]?.lastPage, 4);
    useViewHistory.getState().setLastPage("pixiv", "1", 100);
    assert.equal(useViewHistory.getState().items[0]?.lastPage, 6, "clamp 进条目自己的页数");
    useViewHistory.getState().setLastPage("pixiv", "1", 1.5);
    assert.equal(useViewHistory.getState().items[0]?.lastPage, 6, "非法页码不写");
    const before = useViewHistory.getState().items;
    useViewHistory.getState().setLastPage("pixiv", "missing", 3);
    assert.equal(useViewHistory.getState().items, before, "无条目 no-op，不为水位造历史");
    useViewHistory.setState({ items: [], authors: [] }); // 还原共享 store，别漏给后面的用例
  });

  it("resumePage 五情形：无水位/单页/首页/看完 → null，翻到中途 → 定位页", () => {
    assert.equal(resumePage(undefined, 7), null);
    assert.equal(resumePage({ ...entry("1") }, 7), null, "没写过水位不定位");
    assert.equal(resumePage({ ...entry("1"), lastPage: 3 }, 1), null, "单页作品不定位");
    assert.equal(resumePage({ ...entry("1"), lastPage: 0 }, 7), null, "clamp 后 0 = 没翻过");
    assert.equal(resumePage({ ...entry("1"), lastPage: 6 }, 7), null, "clamp 后末页 = 看完，不复位提示");
    assert.equal(resumePage({ ...entry("1"), lastPage: 5 }, 7), 5);
    assert.equal(resumePage({ ...entry("1"), lastPage: 50 }, 7), null, "旧记录越界 clamp 到末页 = 看完");
  });
});
