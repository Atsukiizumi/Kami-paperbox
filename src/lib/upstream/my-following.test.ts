import assert from "node:assert/strict";
import { test } from "node:test";
import { mapMyFollowing } from "./pixiv.ts";

test("mapMyFollowing：users → items；total 决定 nextPage；坏项丢弃", () => {
  const json = {
    error: false,
    body: {
      total: 30,
      users: [
        { userId: "11", userName: "画师A", profileImageUrl: "https://i.pximg.net/a.jpg" },
        { userId: "", userName: "无ID" }, // 丢弃
        { userName: "也没ID" }, // 丢弃
        { userId: "22", userName: "画师B", profileImageUrl: "javascript:alert(1)" }, // 非法头像置空
      ],
    },
  };
  const { items, nextPage } = mapMyFollowing(json, 0);
  assert.deepEqual(items, [
    { id: "11", name: "画师A", avatar: "https://i.pximg.net/a.jpg" },
    { id: "22", name: "画师B", avatar: "" },
  ]);
  assert.equal(nextPage, 2); // 0+2 < 30
  // 末页判定：offset(24)+2 = 26 = total → 无下一页
  const last = mapMyFollowing({ error: false, body: { total: 26, users: json.body.users } }, 24);
  assert.equal(last.nextPage, null);
});

test("mapMyFollowing：error 响应抛错", () => {
  assert.throws(() => mapMyFollowing({ error: true, message: "×" }, 0), /×/);
});
