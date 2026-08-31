import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { zipSync } from "fflate";
import { unzipUgoira } from "./ugoira-zip.ts";
import { extFromNameOrType, mapUgoiraMeta } from "./ugoira-meta.ts";

describe("ugoira meta", () => {
  it("maps pixiv ugoira_meta body", () => {
    const meta = mapUgoiraMeta({
      body: {
        src: "https://i.pximg.net/img-zip-ugoira/a_ugoira600x600.zip",
        originalSrc: "https://i.pximg.net/img-zip-ugoira/a_ugoira1920x1920.zip",
        mime_type: "image/jpeg",
        frames: [
          { file: "000000.jpg", delay: 80 },
          { file: "000001.jpg", delay: 80 },
        ],
      },
    });
    assert.ok(meta);
    assert.equal(meta.frames.length, 2);
    assert.match(meta.originalSrc, /1920x1920/);
  });

  it("returns null without frames", () => {
    assert.equal(mapUgoiraMeta({ body: { src: "x", frames: [] } }), null);
  });

  it("picks file extension from name or mime", () => {
    assert.equal(extFromNameOrType("loop.gif"), "gif");
    assert.equal(extFromNameOrType("photo.JPEG"), "jpg");
    assert.equal(extFromNameOrType(undefined, "image/gif"), "gif");
    assert.equal(extFromNameOrType(undefined, "application/zip"), "zip");
  });

  it("unzips named frames from a ugoira zip", async () => {
    const zip = zipSync({
      "000000.jpg": new Uint8Array([1, 2, 3]),
      "000001.jpg": new Uint8Array([4, 5]),
    });
    const frames = await unzipUgoira(zip, [
      { file: "000000.jpg", delay: 50 },
      { file: "000001.jpg", delay: 50 },
      { file: "missing.jpg", delay: 50 },
    ]);
    assert.equal(frames.length, 2);
    assert.equal(frames[0].bytes.length, 3);
  });
});
