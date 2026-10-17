/**
 * 收藏夹映射层测试（B1，design §5 T1）。
 *
 * 样本双模式（mapping.test.ts 先例）：tests/fixtures/upstream/pixiv_my_bookmarks.json
 * 真快照在库则优先单开快照用例（登录端点，需 KAMI_PIXIV_COOKIE 手动跑抓取脚本），
 * 缺省回退内联样本——内联样本按 design §1.1 形状假设手写（works 数组、tags 纯
 * 字符串、bookmarkData、aiType/illust_content_type 缺席），仓库 clone 即 hermetic。
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { loadUpstreamFixture } from "../../../tests/fixtures/upstream/loader.ts";
import { fetchSchema } from "../source.ts";
import { mapMyBookmarks } from "./pixiv.ts";

// 收藏夹条目形状：据 pixiv-ajax-api-docs 快照（design §1.1）——aiType 与
// illust_content_type 在该端点缺席，safeMode 过滤只能靠 xRestrict/sl。
const worksItem = {
  id: "12345",
  title: "夕立",
  illustType: 0,
  xRestrict: 0,
  restrict: 0,
  sl: 2,
  url: "https://i.pximg.net/c/240x240/img-master/img/2026/01/02/00/00/00/12345_p0_square1200.jpg",
  userId: "777",
  userName: "画家",
  width: 1000,
  height: 1600,
  pageCount: 2,
  createDate: "2026-01-02T03:04:05+09:00",
  updateDate: "2026-01-02T03:04:05+09:00",
  isMasked: false,
  profileImageUrl: "https://i.pximg.net/user-profile/img/2026/01/01/777.jpg",
  tags: ["夕立", "艦これ"],
  bookmarkData: { id: "bookmark-1", private: false },
};

function worksJson(works: unknown[], total: number): unknown {
  return { error: false, message: "", body: { works, total } };
}

test("mapMyBookmarks：works 数组 → WorkCard（tags 字符串数组、bookmarkData → bookmarked）", () => {
  const { items, nextPage, total } = mapMyBookmarks(worksJson([worksItem], 50), 0, 48);
  assert.equal(items.length, 1);
  const card = items[0]!;
  assert.equal(card.source, "pixiv");
  assert.equal(card.id, "12345");
  assert.equal(card.title, "夕立");
  assert.equal(card.author, "画家");
  assert.equal(card.authorId, "777");
  assert.equal(card.thumb, worksItem.url);
  assert.equal(card.pageCount, 2);
  assert.deepEqual(card.tags, ["夕立", "艦これ"], "收藏夹 tags 是纯字符串数组，直接透传");
  assert.equal(card.bookmarked, true, "bookmarkData.id 在 → 收藏夹来源必然已收藏");
  assert.equal(total, 50, "total 随映射透出给向导做进度");
  assert.equal(nextPage, 2, "0 + 1 < 50 → 下一页");
});

test("mapMyBookmarks：total 决定 nextPage，末页 null", () => {
  // offset 48（第 2 页）+ 实际 1 条 = 49 ≥ total 49 → 终页
  const last = mapMyBookmarks(worksJson([worksItem], 49), 48, 48);
  assert.equal(last.nextPage, null);
});

test("mapMyBookmarks：works 按 id 键的对象形态（回退端点 A 变体）同一 mapper", () => {
  const objectForm = {
    error: false,
    body: { works: { "12345": worksItem, "12346": { ...worksItem, id: "12346" } }, total: 2 },
  };
  const { items, nextPage } = mapMyBookmarks(objectForm, 0, 48);
  assert.deepEqual(items.map((c) => c.id), ["12345", "12346"], "Object.values 保插入序");
  assert.equal(nextPage, null, "0 + 2 ≥ 2 → 终页");
});

test("mapMyBookmarks：works 空 → 无条件终页（total 漂移保险），total 照常透出", () => {
  const { items, nextPage, total } = mapMyBookmarks(worksJson([], 3134), 0, 48);
  assert.deepEqual(items, []);
  assert.equal(nextPage, null);
  assert.equal(total, 3134);
});

test("mapMyBookmarks：error 响应抛 message（兜底文案）", () => {
  assert.throws(() => mapMyBookmarks({ error: true, message: "エラー" }, 0, 48), /エラー/);
  assert.throws(() => mapMyBookmarks({ error: true }, 0, 48), /收藏夹加载失败/);
});

test("mapMyBookmarks：坏项（无 id / isMasked）丢弃", () => {
  const { items } = mapMyBookmarks(
    worksJson([worksItem, { ...worksItem, id: "" }, { ...worksItem, id: "999", isMasked: true }], 3),
    0,
    48,
  );
  assert.deepEqual(items.map((c) => c.id), ["12345"]);
});

test("mapMyBookmarks：safeMode 拦 R-18（xRestrict/sl）；hideAi 走 aiType 与 AI tag 词表兜底", () => {
  const feed = worksJson(
    [
      worksItem,
      { ...worksItem, id: "222", xRestrict: 1 },
      { ...worksItem, id: "333", aiType: 2 },
      { ...worksItem, id: "444", tags: ["AI生成"] }, // 快照无 aiType 时的词表兜底样本
    ],
    4,
  );
  assert.deepEqual(
    mapMyBookmarks(feed, 0, 48, true, false).items.map((c) => c.id),
    ["12345", "333", "444"],
    "safeMode 只拦 R-18；AI 归 hideAi 管",
  );
  assert.deepEqual(
    mapMyBookmarks(feed, 0, 48, true, true).items.map((c) => c.id),
    ["12345"],
    "hideAi：aiType=2 与 AI 特征 tag 都拦（aiType 缺席靠词表）",
  );
  assert.deepEqual(
    mapMyBookmarks(feed, 0, 48, false, false).items.map((c) => c.id),
    ["12345", "222", "333", "444"],
    "safeMode=false 时 R-18 放行",
  );
});

test("快照：收藏夹真实响应过映射层不空转（fixture 在库时）", () => {
  const fx = loadUpstreamFixture("pixiv_my_bookmarks.json");
  if (!fx) return; // 无快照（未设 Cookie / 未跑抓取脚本）→ 内联样本已覆盖，跳过
  const { items } = mapMyBookmarks(fx, 0, 48);
  assert.ok(items.length > 0, "快照应产出卡片——上游形状断供时最先在这里红");
  for (const card of items) {
    assert.ok(card.id && card.thumb, "卡片缺 id/thumb");
    assert.equal(card.bookmarked, true, "收藏夹来源必然已收藏");
  }
});

// ── fetchSchema 分支白名单（T2，无既有 zod 用例文件，并入本文件） ─────────────

test("fetchSchema：pixivMyBookmarks 分支 page 1..63、restrict 白名单", () => {
  assert.equal(fetchSchema.safeParse({ op: "pixivMyBookmarks", page: 1 }).success, true);
  assert.equal(fetchSchema.safeParse({ op: "pixivMyBookmarks", page: 63 }).success, true, "63 页硬顶放行");
  assert.equal(fetchSchema.safeParse({ op: "pixivMyBookmarks", page: 1, restrict: "private" }).success, true);
  assert.equal(fetchSchema.safeParse({ op: "pixivMyBookmarks", page: 0 }).success, false);
  assert.equal(fetchSchema.safeParse({ op: "pixivMyBookmarks", page: 64 }).success, false);
  assert.equal(fetchSchema.safeParse({ op: "pixivMyBookmarks", page: 1.5 }).success, false);
  assert.equal(fetchSchema.safeParse({ op: "pixivMyBookmarks", page: 1, restrict: "x" }).success, false);
});
