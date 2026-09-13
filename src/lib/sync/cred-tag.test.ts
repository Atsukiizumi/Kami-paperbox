import assert from "node:assert/strict";
import { test } from "node:test";
import { credentialTag } from "./cred-tag.ts";

test("credentialTag：确定性、区分度、不泄漏原文", () => {
  assert.equal(credentialTag("PHPSESSID=abc"), credentialTag("PHPSESSID=abc"));
  assert.notEqual(credentialTag("PHPSESSID=abc"), credentialTag("PHPSESSID=abd"));
  assert.equal(credentialTag(""), "");
  assert.equal(credentialTag(undefined), "");
  const tag = credentialTag("PHPSESSID=0123456789abcdef");
  assert.match(tag, /^[0-9a-f]{8}$/);
  assert.ok(!tag.includes("0123456789abcdef"), "指纹不得含原文片段");
});
