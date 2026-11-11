import assert from "node:assert/strict";
import { test } from "node:test";
import { BodyTooLargeError, bodySizeVerdict, capRequestBody, DATA_PLANE_MAX_BYTES } from "./http-body.ts";

test("GET 与未声明长度放行，超限和坏头拒绝", () => {
  assert.equal(bodySizeVerdict("GET", String(DATA_PLANE_MAX_BYTES + 1)), "ok");
  assert.equal(bodySizeVerdict("POST", null), "ok");
  assert.equal(bodySizeVerdict("POST", String(DATA_PLANE_MAX_BYTES)), "ok");
  assert.equal(bodySizeVerdict("POST", String(DATA_PLANE_MAX_BYTES + 1)), "too-large");
  assert.equal(bodySizeVerdict("POST", "-1"), "invalid");
  assert.equal(bodySizeVerdict("POST", "12kb"), "invalid");
});

test("分块正文超过上限时读取失败", async () => {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array(8));
      controller.enqueue(new Uint8Array(8));
      controller.close();
    },
  });
  const request = new Request("http://127.0.0.1/api/source", { method: "POST", body, duplex: "half" } as RequestInit);
  const capped = capRequestBody(request, 10);
  await assert.rejects(capped.text(), BodyTooLargeError);
});
