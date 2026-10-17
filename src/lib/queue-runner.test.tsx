/**
 * queue-runner loadWork x 分支单测（X 账号关联 M6，R5）。
 *
 * 作用：锁「source="x" 的详情回源打 xTweet op、带 X 凭据（xCookie 随
 *      cookiesFromSettings("x")）、响应错 op 一拍抛『返回类型异常』判死」。
 * 样板：routes/queue.test.tsx 头注（fetch 桩 200 + `{}` 一拍判死口径——非 ok
 * 会走 network 类真退避拖死测试）。
 * 环境垫片：../test/dom.ts 必须最先引入（store persist 连 localStorage）。
 */
import "../test/dom.ts";
import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { useSettings } from "@/lib/store";
import { loadWork } from "@/lib/queue-runner";
import type { WorkDetail } from "@/lib/types";

const X_WORK: WorkDetail = {
  source: "x",
  id: "2109985996532261093",
  title: "X 推文标题",
  author: "masara💘@masara_ASM1",
  authorId: "738706683061374977",
  thumb: "https://pbs.twimg.com/media/HUgt.jpg?format=jpg&name=small",
  pageCount: 2,
  tags: ["newbook"],
  description: "推文全文",
  width: 1200,
  height: 1600,
  pages: [
    { thumb: "/t0", regular: "/r0", original: "https://pbs.twimg.com/media/HUgt.jpg?format=jpg&name=orig", width: 1200, height: 1600, kind: "image" },
    { thumb: "/t1", regular: "/r1", original: "https://pbs.twimg.com/media/HUgu.jpg?format=jpg&name=orig", width: 1200, height: 1600, kind: "image" },
  ],
};

type Call = { op?: string; id?: string; xCookie?: string; cursor?: string; handle?: string };

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** 桩：记录 /api/source POST 体；按用例回响应，默认 404。 */
function installFetch(respond: (body: Call) => Response | undefined): Call[] {
  const calls: Call[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url.includes("/api/source") && (init?.method ?? "GET") === "POST") {
      const body = JSON.parse(String(init?.body ?? "{}")) as Call;
      calls.push(body);
      return respond(body) ?? new Response("not found", { status: 404 });
    }
    return new Response("not found", { status: 404 });
  }) as typeof fetch;
  return calls;
}

describe("loadWork x 分支（M6）", () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = originalFetch;
    useSettings.setState({ xCookie: "" });
  });

  it("source=x 打 xTweet（TweetResultByRestId 回源），带上清洗后的 X Cookie，回包 work 原样透传", async () => {
    useSettings.setState({ xCookie: "auth_token=aaaaaaaaaaaaaaaa; ct0=bbbbbbbbbbbbbbbb" });
    const calls = installFetch((body) => (body.op === "xTweet" ? json({ op: "xTweet", work: X_WORK }) : undefined));
    const work = await loadWork("x", "2109985996532261093");
    assert.equal(calls.length, 1, "单次请求");
    assert.equal(calls[0]?.op, "xTweet");
    assert.equal(calls[0]?.id, "2109985996532261093");
    assert.equal(calls[0]?.xCookie, "auth_token=aaaaaaaaaaaaaaaa; ct0=bbbbbbbbbbbbbbbb", "凭据经 cookiesFromSettings(\"x\") 上车");
    assert.deepEqual(work, X_WORK, "r.work 透传（后续 collectWorkFiles 走 /api/media 通用路径）");
  });

  it("无 Cookie 也可回源（xTweet guest 通道）：请求体不带 xCookie 字段", async () => {
    const calls = installFetch((body) => (body.op === "xTweet" ? json({ op: "xTweet", work: X_WORK }) : undefined));
    await loadWork("x", "1");
    assert.equal(calls[0]?.xCookie, undefined, "未配置时省略字段，x.ts 走 guest");
  });

  it("响应错 op 一拍抛「返回类型异常」（对齐既有分支判死口径，无退避）", async () => {
    installFetch(() => json({ op: "xUserMedia", items: [], user: { restId: "1", name: "", avatar: "" } }));
    await assert.rejects(loadWork("x", "1"), /返回类型异常/);
  });
});
