import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readdirSync } from "node:fs";
import { test } from "node:test";
import { DEFAULT_WATERMARK_MB, sweepCache, watermarkConfig } from "./storage/cache-watermark.server.ts";

function workspace(configJson?: string): string {
  const root = mkdtempSync(join(tmpdir(), "kami-wm-"));
  if (configJson) writeFileSync(join(root, "kami.config.json"), configJson);
  return root;
}

function seedCache(root: string, files: { name: string; bytes: number; ageSec: number }[]): void {
  const dir = join(root, ".data", "media");
  mkdirSync(dir, { recursive: true });
  const now = Date.now();
  for (const f of files) {
    writeFileSync(join(dir, f.name), Buffer.alloc(f.bytes));
    utimesSync(join(dir, f.name), new Date(now - f.ageSec * 1000), new Date(now - f.ageSec * 1000));
  }
}

test("水位内不动任何文件", async () => {
  const root = workspace();
  try {
    seedCache(root, [{ name: "a.bin", bytes: 1024, ageSec: 9999 }]);
    assert.equal(await sweepCache("media", root), 0);
    assert.equal(readdirSync(join(root, ".data", "media")).length, 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("超水位按 mtime 从最旧删到 80%", async () => {
  // 上限 1MB：4 个 512KB 文件共 2MB，最旧的 3 个该被删（2MB → 512KB ≤ 80%·1MB）
  const root = workspace('{"cache":{"mediaMaxMb":1}}');
  try {
    seedCache(root, [
      { name: "old1.bin", bytes: 512 * 1024, ageSec: 400 },
      { name: "old2.json", bytes: 512 * 1024, ageSec: 300 },
      { name: "old3.bin", bytes: 512 * 1024, ageSec: 200 },
      { name: "new.bin", bytes: 512 * 1024, ageSec: 1 },
    ]);
    const removed = await sweepCache("media", root);
    assert.equal(removed, 3);
    assert.deepEqual(readdirSync(join(root, ".data", "media")), ["new.bin"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("水位配置缺省与回退", () => {
  const roots = [workspace(), workspace('{"cache":{"mediaMaxMb":"大"}}'), workspace('{"cache":{"sourceMaxMb":16}}')];
  try {
    assert.deepEqual(watermarkConfig(roots[0]!), DEFAULT_WATERMARK_MB);
    assert.equal(watermarkConfig(roots[1]!).media, DEFAULT_WATERMARK_MB.media, "非数字回默认");
    assert.equal(watermarkConfig(roots[2]!).source, 16);
  } finally {
    for (const r of roots) rmSync(r, { recursive: true, force: true });
  }
});

test("目录不存在时安静返回", async () => {
  const root = workspace();
  try {
    assert.equal(await sweepCache("source", root), 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
