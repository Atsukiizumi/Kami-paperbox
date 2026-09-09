/**
 * 上游映射层固定样本测试（TD-01 / R-01：上游改版时最先破这里）。
 *
 * 样本取自各站接口的真实形状（截短、无凭据）：Pixiv ajax 列表条目、
 * FANBOX post.info 正文块、booru posts.json 三种包裹形态。上游接口
 * 一变，这些用例会精确指出哪个字段断供。
 */
import assert from "node:assert/strict";
import { test } from "node:test";
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
  assert.deepEqual(card.tags, ["夕立", "艦これ"]);

  // 无顶层 url 时走 urls.thumb → small → regular
  const viaUrls = mapPixivCard({ ...pixivItem, url: undefined, urls: { small: "s.jpg" } });
  assert.equal(viaUrls?.thumb, "s.jpg");
});

test("mapPixivCard：isMasked / lo 内容直接丢弃", () => {
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
  assert.equal(asBooruPosts([{ id: 1 }]).length, 1);
  assert.equal(asBooruPosts({ posts: [{ id: 1 }, { id: 2 }] }).length, 2);
  assert.equal(asBooruPosts({ id: 9, tags: "x" }).length, 1, "单条 post.json");
  assert.throws(() => asBooruPosts({ success: false, message: "maintenance" }), /maintenance/);
  assert.deepEqual(asBooruPosts({ strange: true }), [], "不认识的形态给空");
});
