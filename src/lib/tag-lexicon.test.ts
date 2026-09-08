import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  lexiconMap,
  mergeExportRows,
  normalizeLexiconKey,
  parseTagLexicon,
  translateBooruToken,
  upsertLexiconRow,
} from "./tag-lexicon.ts";

describe("tag lexicon", () => {
  it("parses en/zh rows and drops empties", () => {
    const rows = parseTagLexicon({
      tags: [
        { en: "Hatsune Miku", zh: "初音未来" },
        { en: "  ", zh: "x" },
        { en: "sky", zh: "天空" },
        { en: "sky", zh: "重复" },
      ],
    });
    assert.deepEqual(rows, [
      { en: "hatsune_miku", zh: "初音未来" },
      { en: "sky", zh: "天空" },
    ]);
  });

  it("lets user rows override the builtin table", () => {
    const map = lexiconMap([{ en: "sky", zh: "青空" }]);
    assert.equal(translateBooruToken("sky", map), "青空");
    assert.equal(translateBooruToken("landscape", map), "风景");
    assert.equal(normalizeLexiconKey("Long Hair"), "long_hair");
  });

  it("exports known tags with blank zh for the user to fill", () => {
    const rows = mergeExportRows(["zz_not_a_real_tag", "sky"], [{ en: "sky", zh: "天空" }]);
    const sky = rows.find((r) => r.en === "sky");
    const missing = rows.find((r) => r.en === "zz_not_a_real_tag");
    assert.equal(sky?.zh, "天空");
    assert.equal(missing?.zh, "");
  });

  it("upserts a translation and clears on empty zh", () => {
    const added = upsertLexiconRow([], "Long Hair", "长发");
    assert.deepEqual(added, [{ en: "long_hair", zh: "长发" }]);
    assert.deepEqual(upsertLexiconRow(added, "long_hair", "  "), []);
  });
});
