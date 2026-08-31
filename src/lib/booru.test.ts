import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  booruListUrl,
  composeBooruTags,
  hasBlockedTags,
  isNsfwRating,
  mapBooruCard,
  mapBooruDetail,
  pickRelatedTag,
  splitTags,
} from "./booru.ts";

describe("booru filters", () => {
  it("always blocks loli/shota tags", () => {
    assert.equal(hasBlockedTags(["landscape", "loli"]), true);
    assert.equal(hasBlockedTags(["shota"]), true);
    assert.equal(hasBlockedTags(["1girl", "solo"]), false);
  });

  it("treats danbooru s as nsfw and moebooru s as safe", () => {
    assert.equal(isNsfwRating("s", "yande"), false);
    assert.equal(isNsfwRating("e", "yande"), true);
    assert.equal(isNsfwRating("g", "danbooru"), false);
    assert.equal(isNsfwRating("s", "danbooru"), true);
    assert.equal(isNsfwRating("e", "danbooru"), true);
  });

  it("composes yande.re rating and exclusions", () => {
    const tags = composeBooruTags("yande", "landscape", true);
    assert.match(tags, /rating:s/);
    assert.match(tags, /-loli/);
    assert.equal(composeBooruTags("yande", "rating:e wet", true).includes("rating:e"), false);
  });

  it("drops blocked yande posts even when rating is s", () => {
    const card = mapBooruCard(
      "yande",
      {
        id: 1,
        tags: "loli landscape",
        rating: "s",
        preview_url: "https://assets.yande.re/data/preview/aa.jpg",
        file_url: "https://files.yande.re/image/aa.jpg",
        author: "x",
        file_ext: "jpg",
      },
      false,
    );
    assert.equal(card, null);
  });

  it("maps yande.re posts", () => {
    const card = mapBooruCard(
      "yande",
      {
        id: 1267938,
        tags: "business_suit fukuchi_kamio wet",
        rating: "s",
        preview_url: "https://assets.yande.re/data/preview/6b.jpg",
        sample_url: "https://files.yande.re/sample/6b.jpg",
        file_url: "https://files.yande.re/image/6b.jpg",
        author: "himeno_nanako",
        width: 1392,
        height: 1867,
        file_ext: "jpg",
        created_at: 1787882691,
      },
      true,
    );
    assert.equal(card?.source, "yande");
    assert.equal(card?.id, "1267938");
    assert.equal(card?.author, "himeno_nanako");
    assert.equal(card?.width, 1392);
    assert.equal(card?.height, 1867);
    const detail = mapBooruDetail("yande", {
      id: 1267938,
      tags: "business_suit",
      rating: "s",
      preview_url: "https://assets.yande.re/data/preview/6b.jpg",
      sample_url: "https://files.yande.re/sample/6b.jpg",
      file_url: "https://files.yande.re/image/6b.jpg",
      author: "himeno_nanako",
      file_ext: "jpg",
      source: "https://x.com/x",
      width: 1392,
      height: 1867,
    }, true);
    assert.equal(detail?.pages[0]?.original.includes("files.yande.re"), true);
    assert.equal(detail?.width, 1392);
    assert.equal(detail?.pages[0]?.width, 1392);
    assert.equal(detail?.pages[0]?.height, 1867);
  });

  it("maps danbooru posts and hides sensitive in safe mode", () => {
    const raw = {
      id: 9,
      tag_string: "1girl solo",
      tag_string_artist: "foo_bar",
      tag_string_character: "hatsune_miku",
      rating: "s",
      preview_file_url: "https://cdn.donmai.us/180x180/a.jpg",
      large_file_url: "https://cdn.donmai.us/sample/a.jpg",
      file_url: "https://cdn.donmai.us/original/a.jpg",
      file_ext: "jpg",
    };
    assert.equal(mapBooruCard("danbooru", raw, true), null);
    const open = mapBooruCard("danbooru", raw, false);
    assert.equal(open?.title.includes("hatsune miku"), true);
    assert.equal(open?.author, "foo bar");
  });

  it("splits tags", () => {
    assert.deepEqual(splitTags("a_b  c"), ["a_b", "c"]);
  });

  it("keeps rating filters on popular lists", () => {
    const url = decodeURIComponent(booruListUrl("yande", "popular", composeBooruTags("yande", "", true), 1));
    assert.match(url, /post\.json/);
    assert.match(url, /order:score/);
    assert.match(url, /rating:s/);
    assert.equal(url.includes("popular_recent"), false);
    assert.equal(pickRelatedTag(["rating:s", "landscape", "sky"]), "landscape");
  });
});
