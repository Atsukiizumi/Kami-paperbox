/**
 * 词表设置页：批量入库后，已经挂着的空译文框失焦不得把新译文删掉。
 */
import "../../test/dom.ts";
import { registerHooks } from "node:module";
import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { act } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useTagCatalog } from "@/lib/tag-catalog";
import { useTagLexicon } from "@/lib/tag-lexicon";

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

const { TagLexiconSection } = await import("./lexicon.tsx");

const lexBefore = useTagLexicon.getState().rows;
const catalogBefore = useTagCatalog.getState().entries;

afterEach(() => {
  cleanup();
  useTagLexicon.setState({ rows: lexBefore });
  useTagCatalog.setState({ entries: catalogBefore });
});

describe("词表译文框", () => {
  it("批量入库后，原先的空框失焦仍留下译文；亲手改过才提交", () => {
    useTagLexicon.setState({ rows: [] });
    useTagCatalog.setState({
      entries: [{ en: "made_up_tag", count: 1, lastSeen: 1, sites: ["danbooru"] }],
    });
    render(<TagLexiconSection />);
    fireEvent.change(screen.getByPlaceholderText("搜英文或中文"), { target: { value: "made_up_tag" } });
    const field = () => screen.getByPlaceholderText("中文") as HTMLInputElement;

    fireEvent.blur(field());
    assert.deepEqual(useTagLexicon.getState().rows, [], "空框失焦不写入");

    act(() => {
      useTagLexicon.getState().addRows([{ en: "made_up_tag", zh: "自造" }]);
    });
    assert.equal(field().value, "自造", "入库后框里显示新译文");
    fireEvent.blur(field());
    assert.equal(useTagLexicon.getState().rows.find((row) => row.en === "made_up_tag")?.zh, "自造");

    fireEvent.change(field(), { target: { value: "" } });
    fireEvent.blur(field());
    assert.equal(useTagLexicon.getState().rows.find((row) => row.en === "made_up_tag"), undefined, "亲手清空仍会删译文");
  });
});
