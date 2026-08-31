import assert from "node:assert/strict";
import { test } from "node:test";
import { parseFanboxMe, parsePixivMe } from "./site-identity.ts";

test("keeps pixiv avatar url", () => {
  const got = parsePixivMe({
    body: {
      user_status: {
        user_id: "42",
        user_name: "紙匣",
        profile_img: { main: "https:\\/\\/i.pximg.net\\/a.png" },
      },
    },
  });
  assert.equal(got?.avatar, "https://i.pximg.net/a.png");
});

test("parses pixiv homepage html fallback", () => {
  const html = `{"userData":{"id":"99","name":"Kami","profileImg":"https://i.pximg.net/b.png"}}`;
  const got = parsePixivMe({}, html);
  assert.equal(got?.id, "99");
  assert.equal(got?.name, "Kami");
});

test("parses fanbox user json", () => {
  const got = parseFanboxMe({
    body: { user: { userId: "7", name: "box", iconUrl: "https://fanbox.example/i.png" } },
  });
  assert.deepEqual(got, { id: "7", name: "box", avatar: "https://fanbox.example/i.png" });
});
