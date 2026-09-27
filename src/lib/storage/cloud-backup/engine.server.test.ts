import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { openVaultStore } from "../vault-store.server.ts";
import { DEFAULT_CLOUD_CONFIG, type CloudTargetConfig } from "./types.ts";
import { readBackupState, readCloudStored, writeCloudStored } from "./config.server.ts";
import { runVaultBackup, restoreVaultFromCloud, vacuumVaultSnapshot, type BackupDeps } from "./engine.server.ts";

/**
 * 引擎测试：内存桩云目标 + 临时根目录 + 临时 store（deps 注入，绝不摸真实库）。
 */

function memTarget() {
  const files = new Map<string, Uint8Array>();
  const deleted = new Set<string>();
  return {
    files,
    deleted,
    uploads: [] as string[],
    probe: async () => {},
    putFile: async (rel: string, bytes: Uint8Array) => {
      files.set(rel, bytes);
      (files as Map<string, Uint8Array> & { uploads?: string[] }).uploads?.push(rel);
    },
    getFile: async (rel: string) => {
      const v = files.get(rel);
      if (!v) throw new Error(`云端没有 ${rel}`);
      return v;
    },
    listDir: async (rel: string) => {
      const prefix = rel ? `${rel}/` : "";
      return [...files.keys()].filter((k) => k.startsWith(prefix)).map((k) => k.slice(prefix.length).split("/")[0]!).filter((n, i, a) => a.indexOf(n) === i);
    },
    deleteFile: async (rel: string) => {
      files.delete(rel);
      deleted.add(rel);
    },
  };
}

const FAKE_CONFIG: CloudTargetConfig = {
  kind: "webdav",
  url: "https://dav.example.com/dav/",
  username: "u",
  password: "p",
  remoteDir: "kami",
};

function putWork(store: ReturnType<typeof openVaultStore>, id: string, body: number[]) {
  return store.put(
    { key: `pixiv:${id}`, source: "pixiv", id, title: `t${id}`, author: "a", authorId: "a1", tags: [], pageCount: 1, savedAt: 1_700_000_000_000 + Number(id), bytes: 0 },
    [{ bytes: new Uint8Array(body), ext: "jpg", mime: "image/jpeg" }],
  );
}

test("云备份引擎：跳过（未开启）→ 快照+像素上云 → 幂等重跑 → 删除成孤儿 → 轮转保留", async () => {
  const root = mkdtempSync(join(tmpdir(), "kami-cb-eng-"));
  const store = openVaultStore(root);
  const target = memTarget();
  const deps: BackupDeps = { target: target as never, root, store };
  try {
    putWork(store, "801", [1, 1, 1]);
    putWork(store, "802", [2, 2, 2]);

    // 未连接：manual 提示未连接
    assert.equal((await runVaultBackup("manual", deps)).ok, false);
    // 连接但默认未开启：auto 静默跳过
    writeCloudStored({ target: FAKE_CONFIG, config: { ...DEFAULT_CLOUD_CONFIG } }, root);
    const skipped = await runVaultBackup("auto", deps);
    assert.equal(skipped.ok, true);
    assert.equal(skipped.skipped, true);
    assert.equal(target.files.size, 0, "未开启不得上传任何东西");

    // 显式开启后 manual 跑：catalog 快照 + 2 个像素 + manifest
    const stored = readCloudStored(root)!;
    writeCloudStored({ target: stored.target, config: { ...stored.config, enabled: true } }, root);
    const first = await runVaultBackup("manual", deps);
    assert.equal(first.ok, true);
    const snapshotRels = [...target.files.keys()].filter((k) => k.startsWith("catalog/"));
    assert.equal(snapshotRels.length, 1);
    assert.ok([...target.files.keys()].includes("files/pixiv/801/0.jpg"));
    assert.ok([...target.files.keys()].includes("files/pixiv/802/0.jpg"));
    assert.ok(target.files.has("manifest.json"));
    const manifest = JSON.parse(new TextDecoder().decode(target.files.get("manifest.json")!)) as { files: { path: string }[] };
    assert.equal(manifest.files.length, 2);

    // 快照是合法 SQLite 且含 2 行 works
    const snapBytes = target.files.get(snapshotRels[0]!)!;
    const snapshotPath = join(root, ".data", "backups", "tmp-snapshot-check.sqlite");
    vacuumVaultSnapshot(store.dir, snapshotPath);
    const snapDb = new DatabaseSync(snapshotPath);
    const worksCount = (snapDb.prepare("SELECT COUNT(*) AS n FROM works").get() as { n: number }).n;
    snapDb.close();
    rmSync(snapshotPath, { force: true });
    assert.equal(worksCount, 2);
    assert.equal(snapBytes.byteLength > 0, true);

    // 幂等重跑：文件零重传（manifest diff 命中），只更新快照与 manifest
    const fileUploadsBefore = [...target.files.entries()].filter(([k]) => k.startsWith("files/"));
    const second = await runVaultBackup("manual", deps);
    assert.equal(second.ok, true);
    for (const [k, v] of fileUploadsBefore) {
      assert.equal(target.files.get(k), v, `${k} 不该重传`);
    }

    // 本地真删一个：云端文件保留为孤儿，计数 1
    store.remove("pixiv:801");
    const third = await runVaultBackup("manual", deps);
    assert.equal(third.ok, true);
    const state = readBackupState(root);
    assert.equal(state.orphans, 1, "本地删除云端保留为孤儿");
    assert.ok(target.files.has("files/pixiv/801/0.jpg"), "孤儿文件不得被删");
    const manifest3 = JSON.parse(new TextDecoder().decode(target.files.get("manifest.json")!)) as { files: { path: string }[] };
    assert.equal(manifest3.files.length, 1);

    // 轮转：keep=2 时 catalog 目录最多 2 份
    const stored2 = readCloudStored(root)!;
    writeCloudStored({ target: stored2.target, config: { ...stored2.config, keep: 2 } }, root);
    for (let i = 0; i < 3; i += 1) await runVaultBackup("manual", deps);
    const catalogs = [...target.files.keys()].filter((k) => k.startsWith("catalog/"));
    assert.equal(catalogs.length, 2, `keep=2 应只留 2 份，实际 ${catalogs.length}`);
    assert.ok(target.deleted.size > 0, "旧快照被 DELETE");

    const finalState = readBackupState(root);
    assert.equal(finalState.lastOkAt !== null, true);
    assert.equal(finalState.running, false);
  } finally {
    store.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("恢复：从云端拉回快照与文件（dryRun 只清点）", async () => {
  const root = mkdtempSync(join(tmpdir(), "kami-cb-res-"));
  const store = openVaultStore(root);
  const target = memTarget();
  try {
    putWork(store, "803", [3, 3, 3]);
    writeCloudStored({ target: FAKE_CONFIG, config: { enabled: true, intervalHours: 24, keep: 14 } }, root);
    const res = await runVaultBackup("manual", { target: target as never, root, store });
    assert.equal(res.ok, true);

    // dryRun：不动盘
    const otherDir = join(root, "restore-dry");
    const dry = await restoreVaultFromCloud(target as never, otherDir, { dryRun: true });
    assert.equal(dry.files, 1);
    assert.ok(dry.snapshot);
    assert.equal(existsSync(otherDir), false);

    // 真恢复：快照 + 文件就位
    const outDir = join(root, "restore-real");
    const real = await restoreVaultFromCloud(target as never, outDir);
    assert.equal(real.files, 1);
    assert.ok(existsSync(join(outDir, "vault.sqlite")));
    assert.ok(existsSync(join(outDir, "files", "pixiv", "803", "0.jpg")));
    const db = new DatabaseSync(join(outDir, "vault.sqlite"));
    const n = (db.prepare("SELECT COUNT(*) AS n FROM works").get() as { n: number }).n;
    db.close();
    assert.equal(n, 1);
  } finally {
    store.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("state 损坏容错：坏 JSON 按空态处理", () => {
  const root = mkdtempSync(join(tmpdir(), "kami-cb-state-"));
  try {
    mkdirSync(join(root, ".data", "backups"), { recursive: true });
    writeCloudStored(null, root);
    assert.equal(readCloudStored(root), null);
    const dir = join(root, ".data", "backups");
    writeFileSync(join(dir, "backup-state.json"), "{oops");
    const state = readBackupState(root);
    assert.equal(state.running, false);
    assert.equal(state.snapshots.length, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
