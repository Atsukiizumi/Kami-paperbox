import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  lexiconMap,
  mergeExportRows,
  normalizeLexiconKey,
  parseTagLexicon,
  translateBooruToken,
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
    const rows = mergeExportRows(["wet", "sky"], [{ en: "sky", zh: "天空" }]);
    const sky = rows.find((r) => r.en === "sky");
    const wet = rows.find((r) => r.en === "wet");
    assert.equal(sky?.zh, "天空");
    assert.equal(wet?.zh, "");
  });
});
