import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DEFAULT_PIXIV_SEARCH,
  buildPixivSearchUrl,
  countActivePixivSearch,
  formatPixivSearchWord,
  localIsoDate,
  parsePixivSearchFilter,
  scdForWhen,
  scopeFromExact,
} from "./pixiv-search.ts";

describe("pixiv search filter", () => {
  it("quotes each tag when exact-matching more than one", () => {
    assert.equal(formatPixivSearchWord("东方 永江衣玖", "s_tag"), "东方 永江衣玖");
    assert.equal(formatPixivSearchWord("东方 永江衣玖", "s_tag_full"), '"东方" "永江衣玖"');
  });

  it("maps tag clicks to exact match and typing to partial", () => {
    assert.equal(scopeFromExact(true), "s_tag_full");
    assert.equal(scopeFromExact(false), "s_tag");
  });

  it("fills missing filter fields", () => {
    const got = parsePixivSearchFilter({ type: "manga", order: "nope" as never });
    assert.equal(got.type, "manga");
    assert.equal(got.order, "date_d");
    assert.equal(got.scope, "s_tag");
  });

  it("counts only non-default conditions", () => {
    assert.equal(countActivePixivSearch(DEFAULT_PIXIV_SEARCH), 0);
    assert.equal(
      countActivePixivSearch({ ...DEFAULT_PIXIV_SEARCH, type: "illust", when: "w", bookmarks: "500" }),
      3,
    );
  });

  it("writes scd as a local calendar day", () => {
    const now = new Date(2026, 8, 1, 22, 0, 0);
    assert.equal(localIsoDate(now, 0), "2026-09-01");
    assert.equal(scdForWhen("d", now), "2026-08-31");
    assert.equal(scdForWhen("w", now), "2026-08-25");
    assert.equal(scdForWhen("m", now), "2026-08-02");
    assert.equal(scdForWhen("any", now), undefined);
  });

  it("builds the ajax URL with the official query names", () => {
    const now = new Date(2026, 8, 1);
    const url = buildPixivSearchUrl(
      "龙泡泡",
      2,
      {
        scope: "s_tag",
        type: "illust",
        order: "popular_d",
        age: "r18",
        when: "w",
        bookmarks: "1000",
        ratio: "landscape",
      },
      { safeMode: false, hideAi: true, now },
    );
    const parsed = new URL(url);
    assert.equal(parsed.pathname, `/ajax/search/artworks/${encodeURIComponent("龙泡泡")}`);
    assert.equal(parsed.searchParams.get("word"), "龙泡泡");
    assert.equal(parsed.searchParams.get("s_mode"), "s_tag");
    assert.equal(parsed.searchParams.get("type"), "illust");
    assert.equal(parsed.searchParams.get("order"), "popular_d");
    assert.equal(parsed.searchParams.get("mode"), "r18");
    assert.equal(parsed.searchParams.get("p"), "2");
    assert.equal(parsed.searchParams.get("scd"), "2026-08-25");
    assert.equal(parsed.searchParams.get("blt"), "1000");
    assert.equal(parsed.searchParams.get("ratio"), "0.5");
    assert.equal(parsed.searchParams.get("ai_type"), "1");
  });

  it("forces safe mode even if the filter asks for r18", () => {
    const url = buildPixivSearchUrl("cat", 1, { ...DEFAULT_PIXIV_SEARCH, age: "r18" }, {
      safeMode: true,
      hideAi: false,
    });
    assert.equal(new URL(url).searchParams.get("mode"), "safe");
    assert.equal(new URL(url).searchParams.get("blt"), null);
    assert.equal(new URL(url).searchParams.get("scd"), null);
  });
});
