/**
 * 追踪页标签订阅视图（09-21-tag-watch-vault-filter）。
 *
 * 作用：锁「画师/标签分段切换」「标签行渲染与取消订阅」「添加标签表单入列」三条 UI 接线。
 * 环境垫片：../test/dom.ts 必须最先引入；检查更新走真 fetch（jsdom 下会失败，
 *        结果行只显示失败态，不影响断言——不 mock 网络层）。
 */
import "../test/dom.ts";
import assert from "node:assert/strict";
import { describe, it, beforeEach } from "node:test";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { WatchArtistRow, WatchPage } from "./watch.tsx";
import type { WatchCheckResult } from "@/lib/watch-check";
import type { WatchArtist } from "@/lib/watch";
import { useSettings } from "@/lib/store";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";

/** WatchPage 用 useNavigate（app router context）；测试里挂一个空桩路由。 */
const stubRouter = {
  push: () => undefined,
  replace: () => undefined,
  back: () => undefined,
  forward: () => undefined,
  prefetch: () => undefined,
  refresh: () => undefined,
};

function renderPage() {
  return render(
    <AppRouterContext.Provider value={stubRouter as never}>
      <WatchPage />
    </AppRouterContext.Provider>,
  );
}

describe("追踪页标签订阅", () => {
  beforeEach(() => {
    cleanup();
    useSettings.setState({ watchArtists: [], watchTags: [], watchLimit: 100 });
  });

  it("切到标签视图：空态提示 → 添加表单订阅入列 → 取消订阅清空", () => {
    renderPage();
    // 默认画师视图：空态
    assert.ok(screen.getByText(/还没有追踪的画师/));
    // 切到标签视图：空态提示两个入口
    fireEvent.click(screen.getByRole("radio", { name: "标签" }));
    assert.ok(screen.getByText(/还没有订阅的标签/));
    // 添加表单：输入标签回车 → 入列
    const input = screen.getByLabelText("订阅标签");
    fireEvent.change(input, { target: { value: "鳴潮" } });
    fireEvent.keyDown(input, { key: "Enter" });
    assert.equal(useSettings.getState().watchTags.length, 1);
    assert.equal(useSettings.getState().watchTags[0]?.tag, "鳴潮");
    // 标签行渲染 + 取消订阅
    const row = screen.getByText("鳴潮");
    assert.ok(row);
    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    assert.equal(useSettings.getState().watchTags.length, 0, "取消订阅即出列");
  });

  it("画师头像走图片代理，不把 pximg 直接交给浏览器", () => {
    useSettings.setState({
      watchArtists: [
        {
          source: "pixiv",
          id: "42",
          name: "猫屋",
          avatar: "https://i.pximg.net/user-profile/img/a.jpg",
          addedAt: 1,
        },
      ],
    });
    const rect = HTMLElement.prototype.getBoundingClientRect;
    HTMLElement.prototype.getBoundingClientRect = () =>
      ({ width: 40, height: 40, top: 0, bottom: 40, left: 0, right: 40, x: 0, y: 0, toJSON() {} }) as DOMRect;
    try {
      const { container } = renderPage();
      const img = container.querySelector("img");
      assert.ok(img);
      assert.match(img?.getAttribute("src") ?? "", /^\/api\/media\?u=/);
      assert.doesNotMatch(img?.getAttribute("src") ?? "", /^https:\/\/i\.pximg\.net/);
    } finally {
      HTMLElement.prototype.getBoundingClientRect = rect;
    }
  });

  it("同词重复订阅不重复入列（toast 提示路径不炸）", () => {
    useSettings.setState({
      watchTags: [{ source: "pixiv", tag: "鳴潮", addedAt: 1 }],
    });
    renderPage();
    fireEvent.click(screen.getByRole("radio", { name: "标签" }));
    const input = screen.getByLabelText("订阅标签");
    fireEvent.change(input, { target: { value: "鳴潮" } });
    fireEvent.click(screen.getByRole("button", { name: /^订阅$/ }));
    assert.equal(useSettings.getState().watchTags.length, 1, "同词不再入列");
  });
});

describe("今日更新聚合视图", () => {
  beforeEach(() => {
    cleanup();
    useSettings.setState({ watchArtists: [], watchTags: [], watchLimit: 100 });
  });

  it("空态：无订阅提示先去订阅；切到视图不炸", () => {
    renderPage();
    fireEvent.click(screen.getByRole("radio", { name: "今日更新" }));
    assert.ok(screen.getByText(/还没有追踪或订阅/));
  });


});

// ── 画师行断更天数（O，10-17-slideshow-stale-clean）──────────────────────────

describe("画师行断更天数", () => {
  beforeEach(() => {
    cleanup();
  });

  const DAY = 86_400_000;

  /** 本地墙上时间 → 带本机偏移的 ISO 串（偏移随串走，daysSince 按本地日历日读回，任何时区跑都确定）。 */
  function isoDaysAgo(days: number): string {
    const d = new Date(Date.now() - days * DAY);
    const off = -d.getTimezoneOffset();
    const sign = off >= 0 ? "+" : "-";
    const pad = (n: number) => String(n).padStart(2, "0");
    return (
      `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
      `T${pad(d.getHours())}:${pad(d.getMinutes())}:00${sign}${pad(Math.floor(Math.abs(off) / 60))}:${pad(Math.abs(off) % 60)}`
    );
  }

  const artist: WatchArtist = { source: "pixiv", id: "42", name: "猫屋", avatar: "", addedAt: 1 };

  function renderRow(opts: { r?: WatchCheckResult; checking?: boolean }) {
    return render(
      <AppRouterContext.Provider value={stubRouter as never}>
        <WatchArtistRow
          artist={artist}
          r={opts.r}
          checking={opts.checking ?? false}
          onSeen={() => {}}
          onUnwatch={() => {}}
        />
      </AppRouterContext.Provider>,
    );
  }

  function rowLi() {
    return document.body.querySelector("li");
  }

  it("断更 >90 天：整行 opacity-60 grayscale +「100 天没更新了」，按钮仍可点", () => {
    renderRow({ r: { source: "pixiv", id: "42", newCount: 2, newestId: "99", latestDate: isoDaysAgo(100) } });
    assert.match(screen.getByText(/100 天没更新了/).textContent ?? "", /100 天没更新了/);
    assert.match(rowLi()?.className ?? "", /grayscale/, "整行标灰（连头像一起）");
    const unwatch = screen.getByRole("button", { name: "取消" }) as HTMLButtonElement;
    assert.equal(unwatch.disabled, false, "标灰不禁用：取消追踪仍可点");
    const seen = screen.getByRole("button", { name: "标为已读" }) as HTMLButtonElement;
    assert.equal(seen.disabled, false, "标为已读仍可点");
  });

  it("断更 ≤90 天：正常天数段文案，无标灰类", () => {
    renderRow({ r: { source: "pixiv", id: "42", newCount: 0, latestDate: isoDaysAgo(10) } });
    assert.match(screen.getByText(/距上次更新 10 天/).textContent ?? "", /距上次更新 10 天/);
    assert.doesNotMatch(rowLi()?.className ?? "", /grayscale/);
    assert.doesNotMatch(rowLi()?.className ?? "", /opacity-60/);
  });

  it("有检查结果但 latestDate 缺：出「距上次更新 —」，不标灰", () => {
    renderRow({ r: { source: "pixiv", id: "42", newCount: 0 } });
    assert.match(document.body.textContent ?? "", /距上次更新 —/);
    assert.doesNotMatch(rowLi()?.className ?? "", /grayscale/);
  });

  it("未检查（无 r）：「还没检查过」且无天数段，不标灰", () => {
    renderRow({});
    assert.match(document.body.textContent ?? "", /还没检查过/);
    assert.doesNotMatch(document.body.textContent ?? "", /距上次更新/);
    assert.doesNotMatch(rowLi()?.className ?? "", /grayscale/);
  });

  it("error 优先：检查失败行不出天数段（catch 分支不落 latestDate，别读成断更）", () => {
    renderRow({ r: { source: "pixiv", id: "42", newCount: 0, error: "Cookie 失效", latestDate: isoDaysAgo(100) } });
    assert.match(document.body.textContent ?? "", /检查失败：Cookie 失效/);
    assert.doesNotMatch(document.body.textContent ?? "", /距上次更新/);
    assert.doesNotMatch(document.body.textContent ?? "", /没更新了/);
    assert.doesNotMatch(rowLi()?.className ?? "", /grayscale/, "error 行不标灰");
  });
});
