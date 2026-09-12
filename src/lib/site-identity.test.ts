import assert from "node:assert/strict";
import { test } from "node:test";
import { decodeHtmlEntities, parseFanboxMe, parsePixivMe } from "./site-identity.ts";

test("decodes html entities in attribute payloads (TD-37)", () => {
  assert.equal(decodeHtmlEntities("&quot;a&#39;b&amp;c&quot;"), `"a'b&c"`);
  // &amp; 最后解：&amp;quot; 是被转义过的字面 &quot;，不能再展开成引号
  assert.equal(decodeHtmlEntities("&amp;quot;"), "&quot;");
  // meta 属性里真实出现的转义 JSON
  assert.equal(
    decodeHtmlEntities("{&quot;name&quot;:&quot;紙&quot;}"),
    `{"name":"紙"}`,
  );
});

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

test("rejects pixiv guest status", () => {
  const got = parsePixivMe({
    body: {
      user_status: {
        is_login: false,
        user_id: "0",
        user_name: "",
      },
    },
  });
  assert.equal(got, null);
});

test("parses pixiv homepage html fallback", () => {
  const html = `{"userData":{"id":"99","name":"Kami","profileImg":"https://i.pximg.net/b.png"}}`;
  const got = parsePixivMe({}, html);
  assert.equal(got?.id, "99");
  assert.equal(got?.name, "Kami");
  assert.equal(got?.avatar, "https://i.pximg.net/b.png");
});

test("parses meta-global-data userData", () => {
  const html = `<meta id="meta-global-data" content='{"token":"abc","userData":{"id":"7","name":"紙","profileImg":"https://i.pximg.net/c.png"}}'>`;
  const got = parsePixivMe({}, html);
  assert.equal(got?.id, "7");
  assert.equal(got?.name, "紙");
});

test("parses fanbox user json", () => {
  const got = parseFanboxMe({
    body: { user: { userId: "7", name: "box", iconUrl: "https://fanbox.example/i.png" } },
  });
  assert.deepEqual(got, { id: "7", name: "box", avatar: "https://fanbox.example/i.png" });
});
