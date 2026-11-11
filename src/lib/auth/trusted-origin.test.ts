import assert from "node:assert/strict";
import { test } from "node:test";
import { reflectableHostOrigins, trustedOriginsFor } from "./trusted-origin.ts";

test("局域网 IP、localhost、机器名和 .local 可以回声", () => {
  assert.deepEqual(reflectableHostOrigins("192.168.32.6:8080"), [
    "http://192.168.32.6:8080",
    "https://192.168.32.6:8080",
  ]);
  assert.deepEqual(reflectableHostOrigins("[::1]:8080"), ["http://[::1]:8080", "https://[::1]:8080"]);
  assert.deepEqual(reflectableHostOrigins("desktop:8080"), ["http://desktop:8080", "https://desktop:8080"]);
  assert.ok(reflectableHostOrigins("kami.local:8080").includes("http://kami.local:8080"));
});

test("公网域名不按 Host 回声，显式基址仍然保留", () => {
  assert.deepEqual(reflectableHostOrigins("evil.example"), []);
  assert.deepEqual(reflectableHostOrigins("rebind.attacker.net:8080"), []);
  assert.deepEqual(reflectableHostOrigins("evil.example@127.0.0.1"), []);
  const list = trustedOriginsFor("evil.example", "https://kami.example");
  assert.ok(list.includes("https://kami.example"));
  assert.ok(list.includes("http://127.0.0.1:8080"));
  assert.equal(list.some((origin) => origin.includes("evil.example")), false);
});
