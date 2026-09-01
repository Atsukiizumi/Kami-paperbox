import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { closeOnAbort, isAbortError } from "./abort.ts";

describe("isAbortError", () => {
  it("reads AbortError and aborted messages", () => {
    assert.equal(isAbortError(new DOMException("This operation was aborted", "AbortError")), true);
    assert.equal(isAbortError(Object.assign(new Error("aborted"), { code: undefined })), true);
    assert.equal(isAbortError(new Error("boom")), false);
    assert.equal(isAbortError(null), false);
  });

  it("follows ECONNRESET nested in cause", () => {
    const cause = Object.assign(new Error("aborted"), { code: "ECONNRESET" });
    const wrap = Object.assign(new Error("aborted"), { cause, unhandled: true, status: 500 });
    assert.equal(isAbortError(wrap), true);
    assert.equal(isAbortError({ code: "ECONNABORTED", message: "socket hang up" }), true);
  });
});

describe("closeOnAbort", () => {
  it("closes immediately if the signal is already aborted", async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(new Uint8Array([1]));
        c.close();
      },
    });
    const wrapped = closeOnAbort(body, ctrl.signal);
    const reader = wrapped.getReader();
    const first = await reader.read();
    assert.equal(first.done, true);
  });

  it("closes instead of erroring when the upstream throws AbortError", async () => {
    let pulls = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(c) {
        pulls += 1;
        if (pulls === 1) {
          c.enqueue(new Uint8Array([1]));
          return;
        }
        throw new DOMException("This operation was aborted", "AbortError");
      },
    });
    const wrapped = closeOnAbort(body);
    const reader = wrapped.getReader();
    const first = await reader.read();
    assert.deepEqual(first.value, new Uint8Array([1]));
    const second = await reader.read();
    assert.equal(second.done, true);
  });
});
