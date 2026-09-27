import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isLexiconTargetToken,
  lexiconMap,
  lexiconTokens,
  mergeExportRows,
  normalizeLexiconKey,
  parseBatchRows,
  parseTagLexicon,
  translateBooruToken,
  untranslatedTokens,
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

describe("lexicon token 判定（弱标记 / 缺口统计的底座）", () => {
  it("lexiconTokens 逐段归一键（同 displayTag split 口径），空段剔除", () => {
    assert.deepEqual(lexiconTokens("Hatsune_Miku"), ["hatsune_miku"]);
    assert.deepEqual(lexiconTokens("Hatsune Miku"), ["hatsune", "miku"]); // 空格段各自成 token
    assert.deepEqual(lexiconTokens("  landscape   sky  "), ["landscape", "sky"]);
    assert.deepEqual(lexiconTokens(""), []);
    assert.deepEqual(lexiconTokens("   "), []);
  });

  it("isLexiconTargetToken：可打印 ASCII 真，CJK / 全角 / 空 假", () => {
    assert.equal(isLexiconTargetToken("hatsune_miku"), true);
    assert.equal(isLexiconTargetToken("close-up"), true);
    assert.equal(isLexiconTargetToken("rating:s"), true);
    assert.equal(isLexiconTargetToken("鳴潮"), false);
    assert.equal(isLexiconTargetToken("ｗｕｔｈｅｒｉｎｇ"), false); // 全角不归词表管
    assert.equal(isLexiconTargetToken(""), false);
  });

  it("untranslatedTokens 只报词表可翻且未命中的 token", () => {
    const map = new Map([["long_hair", "长发"]]);
    assert.deepEqual(untranslatedTokens("long_hair megami_magazine 鳴潮", map), ["megami_magazine"]);
    assert.deepEqual(untranslatedTokens("long_hair", map), []);
    assert.deepEqual(untranslatedTokens("鳴潮", map), []); // 非 lexicon-target 永不报缺口
  });
});

describe("parseBatchRows（批量补录解析）", () => {
  it("= 形与 Tab 形都合法；en 归一化；zh 两端 trim", () => {
    assert.deepEqual(parseBatchRows("Long Hair=长发\nmegami_magazine\t女神杂志").ok, [
      { en: "long_hair", zh: "长发" },
      { en: "megami_magazine", zh: "女神杂志" },
    ]);
  });

  it("合法 / 非法 / 空行混合：空行不计数，非法行进 bad", () => {
    const { ok, bad } = parseBatchRows("a=甲\n\n   \nno_separator\n=empty_en\nempty_zh=\nc=b");
    assert.deepEqual(ok, [
      { en: "a", zh: "甲" },
      { en: "c", zh: "b" },
    ]);
    assert.equal(bad, 3); // 无分隔 / 空 en / 空 zh；两个空行不算
  });

  it("= 只切第一刀（zh 里的 = 保留）；Tab 形 zh 止于下一个 Tab（Excel 备注列丢弃）", () => {
    assert.deepEqual(parseBatchRows("en=a=b").ok, [{ en: "en", zh: "a=b" }]);
    assert.deepEqual(parseBatchRows("en\t长\t备注列").ok, [{ en: "en", zh: "长" }]);
  });

  it("批内重复 en 首者胜，静默并入不记 bad", () => {
    const { ok, bad } = parseBatchRows("sky=天空\nsky=青空");
    assert.deepEqual(ok, [{ en: "sky", zh: "天空" }]);
    assert.equal(bad, 0);
  });

  it("空 zh 判非法（比 parseTagLexicon 刻意更严：空 zh 是删译文语义）", () => {
    const { ok, bad } = parseBatchRows("sky=\nno_sep\n\n  \n=甲");
    assert.deepEqual(ok, []);
    assert.equal(bad, 3);
  });
});
