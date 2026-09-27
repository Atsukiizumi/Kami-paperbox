/**
 * CardCaption（卡片题注）RTL：未翻 booru tag 弱标记 + 快译回调/热更链；pixiv 零变化回归。
 */
import "../test/dom.ts";
import { registerHooks } from "node:module";
import assert from "node:assert/strict";
import { describe, it, beforeEach } from "node:test";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useTagLexicon } from "@/lib/tag-lexicon";
import type { WorkCard } from "@/lib/types";

// node:test 不认 .css（题注链上无 css，保险起见与 vault-filter.test 同款垫片）
registerHooks({
  load(url, context, nextLoad) {
    if (url.split("?")[0].endsWith(".css")) {
      return { format: "module", source: "export default {}", shortCircuit: true };
    }
    return nextLoad(url, context);
  },
});

{
  const w = window as unknown as Record<string, unknown>;
  const g = globalThis as unknown as Record<string, unknown>;
  for (const key of ["Event", "CustomEvent", "MouseEvent", "PointerEvent", "KeyboardEvent", "FocusEvent", "MutationObserver"]) {
    if (w[key] !== undefined) g[key] = w[key];
  }
}

const { CardCaption } = await import("./card-caption.tsx");

function work(over: Partial<WorkCard>): WorkCard {
  return {
    source: "danbooru",
    id: "1",
    title: "图",
    author: "artist",
    authorId: "",
    thumb: "",
    pageCount: 1,
    tags: [],
    ...over,
  };
}

describe("CardCaption 未翻标记与快译", () => {
  beforeEach(() => {
    cleanup();
    useTagLexicon.setState({ rows: [] }); // 隔离词表状态：判定走 BUILTIN + 预置行
  });

  it("未翻 booru tag：虚点弱标记 + title 留原文；内置已翻 tag 显示中文无标记", () => {
    render(
      <CardCaption
        work={work({ tags: ["megami_magazine", "long_hair"] })}
        resolution="1000x1000"
        searchTag={() => {}}
      />,
    );
    const untranslated = screen.getByTitle("未翻译：megami_magazine");
    assert.match(untranslated.className, /decoration-dotted/);
    assert.match(untranslated.textContent ?? "", /megami magazine/); // displayTag 回退：下划线转空格
    const translated = screen.getByTitle("搜索「长发」");
    assert.match(translated.textContent ?? "", /长发/);
    assert.doesNotMatch(translated.className, /decoration-dotted/);
  });

  it("pixiv tag 零变化：title 恒为搜索提示、无弱标记 class", () => {
    render(
      <CardCaption work={work({ source: "pixiv", tags: ["オリジナル"] })} resolution="" searchTag={() => {}} />,
    );
    const tag = screen.getByTitle("搜索「オリジナル」");
    assert.match(tag.textContent ?? "", /オリジナル/);
    assert.doesNotMatch(tag.className, /decoration-dotted/);
  });

  it("右键未翻 tag 出快译回调；右键已翻 tag 不出（T4：拦截只落在未翻面）", () => {
    const calls: Array<{ tag: string; pos: { x: number; y: number } }> = [];
    render(
      <CardCaption
        work={work({ tags: ["megami_magazine", "long_hair"] })}
        resolution=""
        searchTag={() => {}}
        onQuickTranslate={(tag, pos) => calls.push({ tag, pos })}
      />,
    );
    fireEvent.contextMenu(screen.getByTitle("未翻译：megami_magazine"));
    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.tag, "megami_magazine");
    assert.equal(typeof calls[0]?.pos.x, "number");
    // 已翻 tag：无 onContextMenu 接线，事件归卡级菜单，快译回调不动
    fireEvent.contextMenu(screen.getByTitle("搜索「长发」"));
    assert.equal(calls.length, 1);
  });

  it("写入词表后本卡即时变中文（rows 订阅热更链，T4 AC）", () => {
    render(
      <CardCaption
        work={work({ tags: ["megami_magazine"] })}
        resolution=""
        searchTag={() => {}}
        onQuickTranslate={(tag) => useTagLexicon.getState().setZh(tag, "女神杂志")}
      />,
    );
    fireEvent.contextMenu(screen.getByTitle("未翻译：megami_magazine"));
    const after = screen.getByTitle("搜索「女神杂志」");
    assert.match(after.textContent ?? "", /女神杂志/);
    assert.doesNotMatch(after.className, /decoration-dotted/);
    assert.equal(screen.queryByTitle("未翻译：megami_magazine"), null);
  });
});
