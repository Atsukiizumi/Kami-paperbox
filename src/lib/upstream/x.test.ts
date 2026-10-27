/**
 * X 适配器单测（M2）：响应→Work 映射（真实 fixtures，M0 实测快照）、串行闸门
 * （假时钟）、queryId 覆盖优先级、GraphQL 错误信封、Cookie 会话解析。
 * fixtures 缺库时 loader 回 null——X 快照随本提交入库，缺了就是 checkout 损坏，
 * 直接 assert 失败不静默跳过（区别于 mapping.test.ts 的抓取型 fixture）。
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { loadUpstreamFixture } from "../../../tests/fixtures/upstream/loader.ts";
import {
  X_MIN_INTERVAL_MS,
  X_QUERY_IDS,
  checkXGraphQLErrors,
  mapXTweetCard,
  mapXTweetDetail,
  mapXUserByScreenName,
  mapXUserMedia,
  newXGate,
  parseXCookie,
  resolveXQueryIds,
  runExclusive,
  setXMinIntervalMs,
  xGateIntervalForTest,
  xPbsVariant,
  xUserMedia,
  type XClock,
} from "./x.ts";
import { UpstreamError } from "./http.ts";

/** 快照随仓库走，缺库 = 损坏，不回退合成样本（hermetic 且更严）。 */
function xFixture(name: string): Record<string, unknown> {
  const fx = loadUpstreamFixture(name);
  assert.ok(fx, `${name} fixture 应在库（tests/fixtures/upstream/）`);
  return { data: fx };
}

/** 合成推（fixture 之外的防御分支用：转发 / 纯文字 / 视频 / 长文）。 */
function tweet(over: Record<string, unknown> = {}): Record<string, unknown> {
  // legacy 单独合入（顶层 ...over 会整体覆盖 legacy，历史踩点）
  const { legacy: legacyOver, ...rest } = over;
  return {
    __typename: "Tweet",
    rest_id: "1111000000000000000",
    core: {
      user_results: {
        result: {
          __typename: "User",
          rest_id: "22220000",
          core: { name: "画師アイ", screen_name: "artist_ai" },
          avatar: { image_url: "https://pbs.twimg.com/profile_images/1/ava_normal.jpg" },
        },
      },
    },
    legacy: {
      full_text: "新刊の表紙です #NewBook https://t.co/abc123",
      created_at: "Fri Oct 16 12:00:00 +0000 2026",
      possibly_sensitive: false,
      favorite_count: 42,
      entities: {
        hashtags: [{ text: "NewBook" }, { text: "newbook" }],
        media: [
          {
            type: "photo",
            media_url_https: "https://pbs.twimg.com/media/GhX1.jpg",
            original_info: { width: 1200, height: 1600 },
          },
          {
            type: "photo",
            media_url_https: "https://pbs.twimg.com/media/GhX2.jpg",
            original_info: { width: 1200, height: 1600 },
          },
        ],
      },
      ...((legacyOver as Record<string, unknown>) ?? {}),
    },
    extended_entities: { media: [] },
    ...rest,
  };
}

// ── UserMedia 映射（真实快照：模块展平 / Bottom 游标 / 空用户判错）──────────

test("UserMedia 快照：TimelineTimelineModule 展平成卡，Bottom 游标回收、Top 忽略", () => {
  const page = mapXUserMedia(xFixture("x_user_media_masara.json"));
  assert.equal(page.user.restId, "738706683061374977");
  assert.equal(page.items.length, 3, "模块内 3 推全部展平（一模块≈一天）");
  assert.equal(
    page.nextCursor,
    "DAABCgABHU2m02P___0KAAIdG7y18VpBlggAAwAAAAIAAA",
    "只回收 Bottom 游标",
  );
  const first = page.items[0]!;
  assert.equal(first.source, "x");
  assert.equal(first.id, "2109985996532261093");
  assert.equal(first.title, "岐阜も鬼カメムシ多かったなー", "t.co 短链剥掉");
  assert.equal(first.author, "masara💘@masara_ASM1", "显示名@handle（M1 原推链接回收位）");
  assert.equal(first.authorId, "738706683061374977");
  assert.equal(first.pageCount, 1);
  assert.equal(first.thumb, "https://pbs.twimg.com/media/HUgtEnQaUAAkdTR.jpg?format=jpg&name=small");
  assert.equal(first.xRestrict, undefined);
  // 其余两推 id 顺序保持模块内顺序
  assert.equal(page.items[1]!.id, "2108911736732746193");
  assert.equal(page.items[2]!.id, "2108842972196594171");
});

test("UserMedia 空用户：{\"data\":{\"user\":{}}} 是上游静默失败，抛可读错误（M0 契约）", () => {
  assert.throws(() => mapXUserMedia({ data: { user: {} } }), /X 用户不存在或 Cookie 已失效/);
  assert.throws(() => mapXUserMedia({ data: {} }), /X 用户不存在或 Cookie 已失效/);
  // 有 restId 但时间线缺主体 → 上游形状断供的可读错误
  assert.throws(
    () => mapXUserMedia({ data: { user: { result: { rest_id: "1", timeline: {} } } } }),
    /无法解析/,
  );
});

test("防御性丢弃：转发（retweeted_status / retweeted_status_result）、纯文字推、坟墓条目不成卡", () => {
  const rt = tweet({ legacy: { retweeted_status: { id: 999 } } });
  const rtResult = tweet({ legacy: { retweeted_status_result: { result: { rest_id: "999" } } } });
  const textOnly = tweet({ legacy: { entities: { media: [] }, full_text: "只有字" } });
  const tombstone = { __typename: "TweetTombstone" };
  assert.equal(mapXTweetCard(rt), null);
  assert.equal(mapXTweetCard(rtResult), null);
  assert.equal(mapXTweetCard(textOnly), null);
  assert.equal(mapXTweetCard(tombstone), null);
});

test("possibly_sensitive → xRestrict=1（D1 角标数据源）；hashtag 小写去重；长文截断 ~80 字", () => {
  const sensitive = tweet({ legacy: { possibly_sensitive: true } });
  assert.equal(mapXTweetCard(sensitive)?.xRestrict, 1);
  assert.deepEqual(mapXTweetCard(tweet())?.tags, ["newbook"], "NewBook/newbook 去重小写");
  const long = "あ".repeat(120);
  const longCard = mapXTweetCard(tweet({ legacy: { full_text: long } }));
  assert.equal(longCard?.title.length, 81);
  assert.ok(longCard?.title.endsWith("…"));
  // 文字剥到空（只有 t.co 链）：title 回退可读占位
  const noText = mapXTweetCard(tweet({ legacy: { full_text: "https://t.co/only" } }));
  assert.equal(noText?.title, "X 推文 1111000000000000000");
});

test("视频 / 非图媒体不计页数；纯视频推整条丢弃", () => {
  const withVideo = tweet({
    extended_entities: {
      media: [
        { type: "photo", media_url_https: "https://pbs.twimg.com/media/GhX1.jpg" },
        { type: "video", media_url_https: "https://pbs.twimg.com/media/GhV.jpg" },
      ],
    },
  });
  assert.equal(mapXTweetCard(withVideo)?.pageCount, 1);
  const videoOnly = tweet({
    legacy: {
      entities: {
        media: [{ type: "video", media_url_https: "https://pbs.twimg.com/media/GhV.jpg" }],
      },
    },
  });
  assert.equal(mapXTweetCard(videoOnly), null);
});

// ── TweetResultByRestId / UserByScreenName 映射（真实快照）──────────────────

test("TweetResultByRestId 快照：扁平 data.tweetResult.result → WorkDetail（name=orig 原图集）", () => {
  const work = mapXTweetDetail(xFixture("x_tweet_result_by_rest_id.json"));
  assert.ok(work);
  assert.equal(work.id, "2109985996532261093");
  assert.equal(work.title, "岐阜も鬼カメムシ多かったなー");
  assert.equal(work.author, "masara💘@masara_ASM1");
  assert.equal(work.authorId, "738706683061374977");
  assert.equal(work.description, "岐阜も鬼カメムシ多かったなー");
  assert.equal(work.pages.length, 1);
  assert.equal(work.pages[0]?.original, "https://pbs.twimg.com/media/HUgtEnQaUAAkdTR.jpg?format=jpg&name=orig");
  assert.equal(work.pages[0]?.regular, "https://pbs.twimg.com/media/HUgtEnQaUAAkdTR.jpg?format=jpg&name=large");
  // TweetWithVisibilityResults 包裹的真身（合成样本：包裹层不带 rest_id）
  const wrapped = mapXTweetDetail({
    data: { tweetResult: { result: { __typename: "TweetWithVisibilityResults", tweet: tweet() } } },
  });
  assert.equal(wrapped?.id, "1111000000000000000");
  assert.equal(wrapped?.pages.length, 2);
  assert.equal(wrapped?.likes, 42);
  // 结果缺位 → null（调用方转可读错误）
  assert.equal(mapXTweetDetail({ data: { tweetResult: { result: {} } } }), null);
  assert.equal(mapXTweetDetail({ data: {} }), null);
});

test("TweetResultById 新根字段：data.tweet_result_by_rest_id.result 同构解析（x-web 改版 2026-10-26）", () => {
  const work = mapXTweetDetail({
    data: { tweet_result_by_rest_id: { result: tweet() } },
  });
  assert.equal(work?.id, "1111000000000000000");
  assert.equal(work?.pages.length, 2);
  // 旧根字段（queryId 被覆盖回旧客户端时）仍兼容
  assert.ok(mapXTweetDetail({ data: { tweetResult: { result: tweet() } } }));
});

test("UserByScreenName 快照：user_result_by_screen_name.result → 四元组", () => {
  const user = mapXUserByScreenName(xFixture("x_user_by_screen_name.json"));
  assert.deepEqual(user, {
    restId: "12985912",
    name: "pixiv",
    handle: "pixiv",
    avatar: "https://pbs.twimg.com/profile_images/1884128769876860928/TlykAoFy_normal.jpg",
  });
  // 旧客户端根字段（queryId 覆盖成旧形态时的响应）也能吃
  const legacyShape = mapXUserByScreenName({
    data: { user: { result: { rest_id: "1", legacy: { name: "n", screen_name: "h" } } } },
  });
  assert.equal(legacyShape.handle, "h");
  assert.throws(() => mapXUserByScreenName({ data: { user_result_by_screen_name: null } }), /X 用户不存在或已改名/);
  assert.throws(() => mapXUserByScreenName({ data: {} }), /X 用户不存在或已改名/);
});

// ── 错误信封 / pbs 变体 ──────────────────────────────────────────────────────

test("GraphQL 错误信封：code 88 → 「X 请求失败（429）」全角格式；认证类 → Cookie 失效标记", () => {
  assert.throws(() => checkXGraphQLErrors({ errors: [{ code: 88, message: "Rate limit exceeded" }] }), (err: unknown) => {
    assert.ok(err instanceof UpstreamError);
    assert.equal((err as UpstreamError).message, "X 请求失败（429）");
    return true;
  });
  assert.throws(
    () => checkXGraphQLErrors({ errors: [{ code: 32, message: "Could not authenticate you" }] }),
    (err: unknown) => err instanceof Error && err.name === "XCookieExpiredError",
  );
  // 有 data 共存的 errors 不算失败
  const ok = checkXGraphQLErrors({ data: { user: { rest_id: "1" } }, errors: [{ code: 224 }] });
  assert.ok(ok && typeof ok === "object");
});

test("pbs 直链变体：format 从尾段推（jpg/jpeg/png/webp），其它扩展名不拼参保持原样", () => {
  assert.equal(xPbsVariant("https://pbs.twimg.com/media/GhX1.png", "orig"), "https://pbs.twimg.com/media/GhX1.png?format=png&name=orig");
  assert.equal(xPbsVariant("https://pbs.twimg.com/media/GhX1.jpeg", "small"), "https://pbs.twimg.com/media/GhX1.jpeg?format=jpeg&name=small");
  assert.equal(xPbsVariant("https://pbs.twimg.com/media/GhX1.webp", "large"), "https://pbs.twimg.com/media/GhX1.webp?format=webp&name=large");
  assert.equal(
    xPbsVariant("https://pbs.twimg.com/media/GhX1.gif", "orig"),
    "https://pbs.twimg.com/media/GhX1.gif",
    "gif 不在四白名单：保持原样不拼参",
  );
  assert.equal(
    xPbsVariant("https://pbs.twimg.com/media/GhX1?format=jpg&name=small", "orig"),
    "https://pbs.twimg.com/media/GhX1?format=jpg&name=small",
    "无扩展名：原样",
  );
});

// ── 串行闸门（假时钟）───────────────────────────────────────────────────────

function fakeClock(startAt = 0): { clock: XClock; now: () => number } {
  let now = startAt;
  return { clock: { now: () => now, sleep: async (ms) => { now += ms; } }, now: () => now };
}

test("闸门：并发调用被排队（并发恒 1），相邻出口间隔 ≥ X_MIN_INTERVAL_MS", async () => {
  const { clock } = fakeClock();
  const gate = newXGate();
  const events: string[] = [];
  const task = (label: string, dur: number) =>
    runExclusive(gate, clock, X_MIN_INTERVAL_MS, async () => {
      events.push(`start:${label}@${clock.now()}`);
      await clock.sleep(dur);
      events.push(`exit:${label}@${clock.now()}`);
      return label;
    });
  const settled = await Promise.all([task("a", 100), task("b", 50), task("c", 50)]);
  assert.deepEqual(settled, ["a", "b", "c"]);
  // 完全串行 + 间隔：a@0-100，b 等 100+1500=1600 起，c 等 1650+1500=3150 起
  assert.deepEqual(events, [
    "start:a@0",
    "exit:a@100",
    "start:b@1600",
    "exit:b@1650",
    "start:c@3150",
    "exit:c@3200",
  ]);
});

test("闸门不毒化：失败任务不挡后续排队；首个任务不空等", async () => {
  const { clock } = fakeClock();
  const gate = newXGate();
  const boom = runExclusive(gate, clock, X_MIN_INTERVAL_MS, async () => {
    throw new Error("boom");
  });
  await assert.rejects(boom, /boom/);
  let ran = false;
  await runExclusive(gate, clock, X_MIN_INTERVAL_MS, async () => {
    ran = true;
  });
  assert.equal(ran, true);
});

test("setXMinIntervalMs：配置注入生效（kami.config.json 接线），非法值回落默认", async () => {
  const { clock } = fakeClock();
  const gate = newXGate();
  setXMinIntervalMs(3000);
  try {
    const stamps: number[] = [];
    const task = () =>
      runExclusive(gate, clock, xGateIntervalForTest(), async () => {
        stamps.push(clock.now());
      });
    await task();
    await task();
    // 第二个任务的出口要等 3000ms 间隔（注入值），不是默认 1500
    assert.equal(stamps[1], 3000);
    // 非法注入回落内置默认
    setXMinIntervalMs(Number.NaN);
    assert.equal(xGateIntervalForTest(), X_MIN_INTERVAL_MS);
  } finally {
    setXMinIntervalMs(X_MIN_INTERVAL_MS); // 复位，别污染其他测试
  }
});

// ── queryId 覆盖 / Cookie 解析 / 入口前置校验 ────────────────────────────────

test("queryId 实证默认表 + resolveXQueryIds：非空覆盖优先，空白回落，不牵连其他键", () => {
  assert.deepEqual(X_QUERY_IDS, {
    userByScreenName: "AMIBMjtxEEATh4z8V9GtRg",
    userMedia: "kc23mh5ZZHOao1q8hzZ1LQ",
    tweetResult: "UECplC_mh3SWNckOf1U3TA",
  }, "2026-10-26 实证值（x-web 改版：UserPhotoTimeline / TweetResultById）——X 前端发版轮换时这里最先红");
  assert.deepEqual(resolveXQueryIds(), X_QUERY_IDS);
  const resolved = resolveXQueryIds({ userMedia: " OVERRIDE ", tweetResult: "" });
  assert.equal(resolved.userMedia, "OVERRIDE", "非空覆盖生效（trim）");
  assert.equal(resolved.tweetResult, X_QUERY_IDS.tweetResult, "空串视为未覆盖");
  assert.equal(resolved.userByScreenName, X_QUERY_IDS.userByScreenName, "其他键不受牵连");
});

test("parseXCookie：抠 auth_token / ct0（名称大小写不敏感），缺项留空", () => {
  assert.deepEqual(parseXCookie("auth_token=abc123; ct0=xyz789; kai=ok"), {
    authToken: "abc123",
    ct0: "xyz789",
  });
  assert.deepEqual(parseXCookie("AUTH_TOKEN=a; CT0=b"), { authToken: "a", ct0: "b" });
  assert.deepEqual(parseXCookie("auth_token=only"), { authToken: "only", ct0: "" });
  assert.deepEqual(parseXCookie(""), { authToken: "", ct0: "" });
});

test("入口前置校验：UserMedia 必须真 Cookie（guest 404），缺 / 残缺抛可读错误（不打上游）", async () => {
  await assert.rejects(() => xUserMedia("artist_ai", undefined, undefined), /未配置 X Cookie/);
  await assert.rejects(() => xUserMedia("artist_ai", undefined, "auth_token=abc"), /不完整/);
  await assert.rejects(() => xUserMedia("artist_ai", "CUR", "ct0=xyz"), /不完整/);
});
