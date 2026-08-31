import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { bookmarkTagsOf, socialFromPixivIllust } from "./social.ts";

describe("pixiv social", () => {
  it("reads bookmark and like flags from illust ajax", () => {
    const off = socialFromPixivIllust({ likeData: false, bookmarkData: null });
    assert.equal(off.liked, false);
    assert.equal(off.bookmarked, false);
    const on = socialFromPixivIllust({
      likeData: true,
      bookmarkData: { id: "99", private: false },
      isFollowed: true,
    });
    assert.equal(on.liked, true);
    assert.equal(on.bookmarked, true);
    assert.equal(on.bookmarkId, "99");
    assert.equal(on.followed, true);
  });

  it("keeps a short tag list for quick bookmark", () => {
    assert.deepEqual(bookmarkTagsOf([" 猫 ", "R-18", "风景"]), ["猫", "风景"]);
  });
});
