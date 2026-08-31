import assert from "node:assert/strict";
import { test } from "node:test";
import { decodeHtmlEntities, fanboxCursorTime, mediaUrl } from "./utils.ts";

test("decodes HTML entities with ampersand last", () => {
  assert.equal(decodeHtmlEntities("A \u0026amp; B"), "A & B");
  assert.equal(decodeHtmlEntities("{\u0026quot;token\u0026quot;:\u0026quot;ab\u0026quot;}"), '{"token":"ab"}');
  assert.equal(decodeHtmlEntities("1 \u0026lt; 2 \u0026gt; 0"), "1 < 2 > 0");
  assert.equal(decodeHtmlEntities("it\u0026#39;s"), "it's");
});

test("normalizes FANBOX cursor timestamps", () => {
  assert.equal(fanboxCursorTime("2024-01-15T12:00:00Z"), "2024-01-15 12:00:00");
  assert.equal(fanboxCursorTime("2024-01-15T12:00:00.123+09:00"), "2024-01-15 12:00:00");
});

test("leaves vault and blob URLs unproxied", () => {
  assert.equal(mediaUrl("/api/vault?key=pixiv:1&page=0"), "/api/vault?key=pixiv:1&page=0");
  assert.equal(mediaUrl("blob:http://local/1"), "blob:http://local/1");
  assert.match(mediaUrl("https://i.pximg.net/a.jpg") ?? "", /api\/media/);
});
