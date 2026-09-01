import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { pixivIdsNewestFirst, pixivPickupItems } from "./pixiv-profile.ts";

describe("pixiv profile order", () => {
  it("sorts numeric illust keys newest first", () => {
    const ids = pixivIdsNewestFirst({ "100": null, "300": null, "200": null }, { "250": null });
    assert.deepEqual(ids, ["300", "250", "200", "100"]);
  });

  it("reads pickup and skips novels", () => {
    const rows = pixivPickupItems([
      { id: "9", type: "illust", title: "pin" },
      { id: "8", type: "novel", title: "book" },
      { id: "9", type: "illust", title: "dup" },
    ]);
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.id, "9");
  });
});
