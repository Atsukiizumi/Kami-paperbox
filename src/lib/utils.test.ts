import assert from "node:assert/strict";
import { test } from "node:test";
import { decodeHtmlEntities } from "./utils.ts";

test("decodes HTML entities with ampersand last", () => {
  assert.equal(decodeHtmlEntities("A \u0026amp; B"), "A & B");
  assert.equal(decodeHtmlEntities("{\u0026quot;token\u0026quot;:\u0026quot;ab\u0026quot;}"), '{"token":"ab"}');
  assert.equal(decodeHtmlEntities("1 \u0026lt; 2 \u0026gt; 0"), "1 < 2 > 0");
  assert.equal(decodeHtmlEntities("it\u0026#39;s"), "it's");
});
