/**
 * 上游映射层固定样本测试（TD-01 / R-01：上游改版时最先破这里）。
 *
 * 样本取自各站接口的真实形状（截短、无凭据）：Pixiv ajax 列表条目、
 * FANBOX post.info 正文块、booru posts.json 三种包裹形态。上游接口
 * 一变，这些用例会精确指出哪个字段断供。
 *
 * M1 双模式：tests/fixtures/upstream/ 下有真实快照（fetch-upstream-fixtures.mjs
 * 产物）则优先取样，缺省回退内联样本——仓库 clone 即 hermetic，永远绿。
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { loadUpstreamFixture } from "../../../tests/fixtures/upstream/loader.ts";
import { mapIllustList, mapPixivCard } from "./pixiv.ts";
import { extractFanboxPages, mapFanboxPostCard, sizeFromFanboxUrl } from "./fanbox.ts";
import { asBooruPosts } from "./booru-sites.ts";

// ── Pixiv 卡片映射 ──────────────────────────────────────────────────────────

const pixivItem = {
  id: "12345",
  title: "夕立",
  userId: "777",
  userName: "画家",
  url: "https://i.pximg.net/c/240x240/img-master/a.jpg",
  pageCount: 2,
  width: 1000,
  height: 1600,
  illustType: 0,
  aiType: 1,
  tags: [{ tag: "夕立" }, { tag: "艦これ" }],
  createDate: "2026-01-02T03:04:05Z",
  totalBookmarks: 100,
  likeData: true,
};

test("mapPixivCard：常规字段与 thumb 回退链", () => {
  const card = mapPixivCard(pixivItem);
  assert.ok(card);
  assert.equal(card.id, "12345");
  assert.equal(card.authorId, "777");
  assert.equal(card.pageCount, 2);
  assert.equal(card.aiType, 1);
  assert.equal(card.xRestrict, undefined, "全年龄作品不带 xRestrict");
  assert.deepEqual(card.tags, ["夕立", "艦これ"]);

  // 无顶层 url 时走 urls.thumb → small → regular
  const viaUrls = mapPixivCard({ ...pixivItem, url: undefined, urls: { small: "s.jpg" } });
  assert.equal(viaUrls?.thumb, "s.jpg");

  // R-18 / R-18G 分级随卡片走（卡牌角标用）
  assert.equal(mapPixivCard({ ...pixivItem, xRestrict: 1 })?.xRestrict, 1);
  assert.equal(mapPixivCard({ ...pixivItem, xRestrict: 2 })?.xRestrict, 2);
});

test("mapPixivCard：isMasked 与 lo 布尔丢弃（数字 lo 不拦，源站是布尔）", () => {
  assert.equal(mapPixivCard({ ...pixivItem, isMasked: true }), null);
  // illust_content_type.lo 源站是布尔；数字形态（老接口/第三方镜像）不拦
  assert.equal(mapPixivCard({ ...pixivItem, illust_content_type: { lo: true } }), null);
  assert.ok(mapPixivCard({ ...pixivItem, illust_content_type: { lo: 1 } }));
});

test("mapIllustList：R-18 过滤、广告跳过、AI 过滤各归其位", () => {
  const feed = {
    body: {
      illustManga: {
        data: [
          pixivItem,
          { ...pixivItem, id: "ad1", title: "广告" },
          { ...pixivItem, id: "222", xRestrict: 1 },
          { ...pixivItem, id: "333", aiType: 2 },
        ],
      },
    },
  };
  // safeMode 只管 R-18；AI 归 hideAi 管
  assert.deepEqual(mapIllustList(feed, true, false).map((c) => c.id), ["12345", "333"]);
  assert.deepEqual(mapIllustList(feed, true, true).map((c) => c.id), ["12345"]);
  assert.deepEqual(
    mapIllustList({ body: { illustManga: { data: [{ ...pixivItem, id: "222", xRestrict: 1 }] } } }, false, false).map((c) => c.id),
    ["222"],
    "safeMode=false 时 R-18 放行",
  );
});

// ── FANBOX 映射 ─────────────────────────────────────────────────────────────

test("sizeFromFanboxUrl：/c/WxH/ 尺寸与边界", () => {
  assert.deepEqual(sizeFromFanboxUrl("https://downloads.fanbox.cc/images/c/1200x630/a.jpg"), {
    width: 1200,
    height: 630,
  });
  assert.deepEqual(sizeFromFanboxUrl("https://downloads.fanbox.cc/images/w/1200x630/a.jpg"), {});
  assert.deepEqual(sizeFromFanboxUrl("https://downloads.fanbox.cc/images/c/10x10/a.jpg"), {}, "过小不算");
  assert.deepEqual(sizeFromFanboxUrl("https://downloads.fanbox.cc/images/c/99999x99999/a.jpg"), {}, "过大不算");
});

test("mapFanboxPostCard：字段映射（成人过滤在调用方，见 mapFanboxItems）", () => {
  const card = mapFanboxPostCard({
    id: "p1",
    title: "投稿",
    creatorId: "creator",
    user: { name: "创作者", userId: "creator" },
    coverImageUrl: "https://downloads.fanbox.cc/images/c/1200x630/cover.jpg",
    publishedDatetime: "2026-01-01 00:00:00",
    tags: ["tag1"],
  });
  assert.ok(card);
  assert.equal(card.id, "p1");
  assert.equal(card.width, 1200, "封面尺寸来自 /c/WxH/");
  // 卡片层不判断成人内容——列表（mapFanboxItems）按 safeMode 过滤
  assert.ok(mapFanboxPostCard({ id: "p2", hasAdultContent: true }));
  // 成人帖标记 xRestrict=1 供卡牌 R-18 角标；普通帖不带
  assert.equal(mapFanboxPostCard({ id: "p2", hasAdultContent: true })?.xRestrict, 1);
  assert.equal(card.xRestrict, undefined, "未声明成人内容的帖子不带 xRestrict");
});

test("extractFanboxPages：blocks+Map 结构、images 兜底、file 块", () => {
  const blockPost = {
    body: {
      blocks: [{ type: "image", imageId: "i1" }, { type: "file", fileId: "f1" }],
      imageMap: { i1: { originalUrl: "o.jpg", thumbnailUrl: "t.jpg" } },
      fileMap: { f1: { url: "f.zip", name: "pack.zip", extension: "zip" } },
    },
  };
  const blocks = extractFanboxPages(blockPost);
  assert.equal(blocks.length, 2);
  assert.equal(blocks[0]?.original, "o.jpg");
  assert.equal(blocks[1]?.kind, "file");
  assert.equal(blocks[1]?.name, "pack.zip");

  const images = extractFanboxPages({
    body: {
      images: [
        {
          originalUrl: "https://downloads.fanbox.cc/images/o/1.jpg",
          thumbnailUrl: "https://downloads.fanbox.cc/images/w/1.jpg",
          width: 800,
          height: 600,
        },
      ],
    },
  });
  assert.equal(images.length, 1);
  assert.equal(images[0]?.width, 800);

  assert.deepEqual(extractFanboxPages({ body: {} }), []);
});

// ── booru posts.json 包裹形态 ──────────────────────────────────────────────

test("asBooruPosts：数组 / {posts} / 单条 / 错误形态", () => {
  // 数组形态优先吃真实 post.json 快照（M1 双模式），缺省回退内联样本
  const realList = fixtureRecordArray("yandere_post.json");
  const arrayForm = realList ?? [{ id: 1 }];
  assert.equal(asBooruPosts(arrayForm).length, arrayForm.length, "数组包裹：条数守恒");
  assert.equal(asBooruPosts({ posts: [{ id: 1 }, { id: 2 }] }).length, 2);
  assert.equal(asBooruPosts({ id: 9, tags: "x" }).length, 1, "单条 post.json");
  assert.throws(() => asBooruPosts({ success: false, message: "maintenance" }), /maintenance/);
  assert.deepEqual(asBooruPosts({ strange: true }), [], "不认识的形态给空");
});

// ── 真实响应快照（M1：fixture 在库时取样，缺省静默跳过） ─────────────────────

/** 读数组包裹的 booru fixture；缺省/形态不符返回 null（回退内联样本）。 */
function fixtureRecordArray(name: string): Record<string, unknown>[] | null {
  const fx = loadUpstreamFixture(name);
  if (!Array.isArray(fx) || fx.length === 0) return null;
  return fx.every((v) => v !== null && typeof v === "object") ? (fx as Record<string, unknown>[]) : null;
}

test("快照：yande 日榜包裹吃得动（fixture 在库时）", () => {
  const fx = fixtureRecordArray("yandere_popular_by_day.json");
  if (!fx) return; // 无快照（抓取失败/未入库）→ 内联样本已覆盖，跳过
  assert.ok(asBooruPosts(fx).length > 0);
});

test("快照：Pixiv 真实响应过映射层不空转（fixture 在库时）", () => {
  // 搜索 / 相关推荐：mapIllustList 直接吃整份响应（body.illustManga.data / body.illusts）
  for (const name of ["pixiv_ajax_search.json", "pixiv_ajax_recommend.json"]) {
    const fx = loadUpstreamFixture(name);
    if (!fx) continue;
    const items = mapIllustList(fx, true, false);
    assert.ok(items.length > 0, `${name} 应产出卡片——上游形状断供时最先在这里红`);
    for (const card of items) {
      assert.ok(card.id && card.thumb, `${name} 卡片缺 id/thumb`);
    }
  }
  // 作品详情：body 是卡片形字段（id/title/userName/urls…），mapPixivCard 可吃
  const detail = loadUpstreamFixture("pixiv_ajax_illust.json") as { body?: Record<string, unknown> } | null;
  if (detail && detail.body) {
    const card = mapPixivCard(detail.body);
    assert.ok(card, "详情快照应产出卡片");
    assert.equal(card.id, String(detail.body.id));
    assert.ok(card.thumb.length > 0, "详情卡片应有缩略图");
  }
});

// ── 日榜未公布窗口的 404 判定 ────────────────────────────────────────────────
import { isUnpublishedWindow404 } from "./pixiv.ts";

test("isUnpublishedWindow404: 窗口内的昨天/今天 404 视为未公布", () => {
  const now = new Date("2026-09-12T00:39:00+09:00"); // JST 09-12 凌晨，0911 榜未公布
  assert.equal(isUnpublishedWindow404("20260911", "Pixiv 请求失败（404）", now), true);
  assert.equal(isUnpublishedWindow404("20260912", "Pixiv 请求失败（404）", now), true);
  assert.equal(isUnpublishedWindow404("20260910", "Pixiv 请求失败（404）", now), false); // 历史日期：真异常
  assert.equal(isUnpublishedWindow404(undefined, "Pixiv 请求失败（404）", now), false);
  assert.equal(isUnpublishedWindow404("20260911", "需要登录 Pixiv 才能查看该榜单。", now), false);
});
