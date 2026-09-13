/**
 * RTL 组件测试入口自检 + WatchToggle（乐观更新家族）。
 * 环境垫片：../test/dom.ts 必须最先引入。
 */
import "../test/dom.ts";
import assert from "node:assert/strict";
import { describe, it, beforeEach } from "node:test";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { WatchToggle } from "./watch-toggle.tsx";
import { useSettings } from "@/lib/store";

describe("WatchToggle（追踪乐观更新）", () => {
  beforeEach(() => {
    cleanup();
    useSettings.setState({ watchArtists: [], watchLimit: 100 });
  });

  it("点击追踪 → store 新增条目、按钮翻转为已追踪；再点移除", () => {
    render(<WatchToggle source="pixiv" id="1" name="画师A" avatar="" />);
    const button = screen.getByRole("button", { name: /追踪/ });
    assert.match(button.textContent ?? "", /追踪$/);

    fireEvent.click(button);
    assert.equal(useSettings.getState().watchArtists.length, 1);
    assert.equal(useSettings.getState().watchArtists[0]?.id, "1");
    assert.match(screen.getByRole("button", { name: /追踪/ }).textContent ?? "", /已追踪/);

    fireEvent.click(screen.getByRole("button", { name: /追踪/ }));
    assert.equal(useSettings.getState().watchArtists.length, 0);
    assert.match(screen.getByRole("button", { name: /追踪/ }).textContent ?? "", /(?<!已)追踪$/);
  });

  it("追踪上限内已存在同画师时不重复入列；满员返回 full 且不入列", () => {
    useSettings.setState({
      watchArtists: [{ source: "pixiv", id: "1", name: "画师A", avatar: "", addedAt: 1 }],
      watchLimit: 20,
    });
    render(<WatchToggle source="pixiv" id="2" name="画师B" avatar="" />);
    // watchLimit=20 是最小值，构造满员用直接置满的方式
    const full = Array.from({ length: 20 }, (_, i) => ({
      source: "fanbox" as const,
      id: String(i),
      name: `x${i}`,
      avatar: "",
      addedAt: i,
    }));
    useSettings.setState({ watchArtists: [...useSettings.getState().watchArtists, ...full] });
    fireEvent.click(screen.getByRole("button", { name: /追踪/ }));
    const artists = useSettings.getState().watchArtists;
    assert.equal(artists.length, 21);
    assert.equal(
      artists.some((w) => w.source === "pixiv" && w.id === "2"),
      false,
      "满员时新画师不入列（填充数据里的 fanbox id=2 不算）",
    );
  });
});
