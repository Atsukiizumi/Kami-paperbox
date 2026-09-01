import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isAbortError } from "./abort.ts";

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
