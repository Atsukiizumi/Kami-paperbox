import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { openVaultStore, type VaultStore } from "../vault-store.server.ts";
import { DEFAULT_CLOUD_CONFIG, type CloudTargetConfig } from "./types.ts";
import { readBackupState, readCloudStored, writeBackupState, writeCloudStored } from "./config.server.ts";
import {
  ensureVaultBackupScheduler,
  isVaultBackupSchedulerActive,
  maybeRunDueBackup,
  reconcileBackupState,
  restoreVaultFromCloud,
  runVaultBackup,
  stopVaultBackupScheduler,
  type BackupDeps,
} from "./engine.server.ts";

/**
 * 引擎测试：内存桩云目标 + 临时根目录 + 临时 store（deps 注入，绝不摸真实库）。
 */

function memTarget() {
  const files = new Map<string, Uint8Array>();
  const deleted = new Set<string>();
  const uploads: string[] = [];
  let failNext = 0;
  return {
    files,
    deleted,
    uploads,
    failNextPut(times: number) {
      failNext = times;
    },
    probe: async () => {},
    putFile: async (rel: string, bytes: Uint8Array) => {
      if (failNext > 0) {
        failNext -= 1;
        throw new Error("模拟网络抖动");
      }
      uploads.push(rel);
      files.set(rel, bytes);
    },
    getFile: async (rel: string) => {
      const v = files.get(rel);
      if (!v) throw new Error(`云端没有 ${rel}`);
      return v;
    },
    listDir: async (rel: string) => {
      const prefix = rel ? `${rel}/` : "";
      return [...files.keys()]
        .filter((k) => k.startsWith(prefix))
        .map((k) => k.slice(prefix.length).split("/")[0]!)
        .filter((n, i, a) => a.indexOf(n) === i);
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

function putWork(store: VaultStore, id: string, body: number[]) {
  return store.put(
    { key: `pixiv:${id}`, source: "pixiv", id, title: `t${id}`, author: "a", authorId: "a1", tags: [], pageCount: 1, savedAt: 1_700_000_000_000 + Number(id), bytes: 0 },
    [{ bytes: new Uint8Array(body), ext: "jpg", mime: "image/jpeg" }],
  );
}

test("云备份引擎：跳过（未开启）→ 快照+像素上云 → 幂等重跑 → 变更重传 → 删除成孤儿 → 轮转保留", async () => {
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

    // 快照字节是合法 SQLite：把云端那份落盘重开，works 2 行
    const snapPath = join(root, ".data", "backups", "snap-check.sqlite");
    writeFileSync(snapPath, target.files.get(snapshotRels[0]!)!);
    const snapDb = new DatabaseSync(snapPath);
    const worksCount = (snapDb.prepare("SELECT COUNT(*) AS n FROM works").get() as { n: number }).n;
    snapDb.close();
    rmSync(snapPath, { force: true });
    assert.equal(worksCount, 2);

    // 幂等重跑：像素零重传（manifest diff 命中），只新快照与 manifest 上传
    assert.equal(target.uploads.filter((u) => u.startsWith("files/")).length, 2);
    const second = await runVaultBackup("manual", deps);
    assert.equal(second.ok, true);
    assert.equal(target.uploads.filter((u) => u.startsWith("files/")).length, 2, "重跑不得重传已上云的像素");

    // 变更检测：同 size 不同 mtime → 该文件重传
    const pageAbs = join(root, ".data", "vault", "files", "pixiv", "801", "0.jpg");
    const future = new Date(Date.now() + 5_000);
    utimesSync(pageAbs, future, future);
    const third = await runVaultBackup("manual", deps);
    assert.equal(third.ok, true);
    assert.equal(target.uploads.filter((u) => u === "files/pixiv/801/0.jpg").length, 2, "mtime 变了要重传这一份");

    // 本地真删一个：云端文件保留为孤儿，计数 1
    store.remove("pixiv:801");
    const fourth = await runVaultBackup("manual", deps);
    assert.equal(fourth.ok, true);
    const state = readBackupState(root);
    assert.equal(state.orphans, 1, "本地删除云端保留为孤儿");
    assert.ok(target.files.has("files/pixiv/801/0.jpg"), "孤儿文件不得被删");
    const manifest4 = JSON.parse(new TextDecoder().decode(target.files.get("manifest.json")!)) as { files: { path: string }[] };
    assert.equal(manifest4.files.length, 1);

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

test("重试：单文件连挂两次第三次成功，整轮不失败", async () => {
  const root = mkdtempSync(join(tmpdir(), "kami-cb-retry-"));
  const store = openVaultStore(root);
  const target = memTarget();
  try {
    putWork(store, "805", [5, 5]);
    writeCloudStored({ target: FAKE_CONFIG, config: { enabled: true, intervalHours: 24, keep: 14 } }, root);
    target.failNextPut(2); // 第一次上传快照就会遇到两次抖动
    const res = await runVaultBackup("manual", { target: target as never, root, store });
    assert.equal(res.ok, true, `应重试成功：${res.error ?? ""}`);
    assert.ok([...target.files.keys()].some((k) => k.startsWith("catalog/")));
  } finally {
    store.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("到期补跑：maybeRunDueBackup 未连接/未开启/未到期都不跑，到期才跑", async () => {
  const root = mkdtempSync(join(tmpdir(), "kami-cb-due-"));
  const store = openVaultStore(root);
  const target = memTarget();
  const deps: BackupDeps = { target: target as never, root, store };
  try {
    putWork(store, "806", [6]);

    assert.equal((await maybeRunDueBackup(deps)).reason, "未连接");
    writeCloudStored({ target: FAKE_CONFIG, config: { ...DEFAULT_CLOUD_CONFIG, enabled: false } }, root);
    assert.equal((await maybeRunDueBackup(deps)).reason, "未开启");

    // 连接 + 开启 + 从未成功（lastOkAt 空）→ 立即到期补跑
    writeCloudStored({ target: FAKE_CONFIG, config: { ...DEFAULT_CLOUD_CONFIG, enabled: true } }, root);
    const due = await maybeRunDueBackup(deps);
    assert.equal(due.ran, true);

    // 刚成功过（lastOkAt=now）→ 未到期
    assert.equal((await maybeRunDueBackup(deps)).reason, "未到期");
    assert.ok(target.uploads.filter((u) => u.startsWith("files/")).length >= 1);
  } finally {
    store.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("崩溃尸体对账：state 里残留 running:true 会被 reconcile 摘掉", () => {
  const root = mkdtempSync(join(tmpdir(), "kami-cb-stale-"));
  const store = openVaultStore(root);
  try {
    putWork(store, "807", [7]);
    writeCloudStored({ target: FAKE_CONFIG, config: { enabled: true, intervalHours: 24, keep: 14 } }, root);
    writeBackupState({ running: true, phase: "files", done: 3, total: 9, bytesDone: 300, lastOkAt: null, lastErrorAt: null, lastError: null, snapshots: [], orphans: 0 }, root);
    const state = reconcileBackupState(root);
    assert.equal(state.running, false, "内存没在跑，尸体要清");
    assert.equal(state.phase, "idle");
    assert.equal(readBackupState(root).running, false, "落盘持久");
  } finally {
    store.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("自禁用：VERCEL 下调度器不启动", async () => {
  const root = mkdtempSync(join(tmpdir(), "kami-cb-vercel-"));
  const store = openVaultStore(root);
  try {
    process.env.VERCEL = "1";
    ensureVaultBackupScheduler(root);
    assert.equal(isVaultBackupSchedulerActive(), false, "Serverless 不该挂定时器");
  } finally {
    delete process.env.VERCEL;
    stopVaultBackupScheduler();
    store.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("恢复：从云端拉回快照与文件（dryRun 只清点）；manifest 穿越路径整个拒绝", async () => {
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

    // manifest 被污染（../ 爬路径）：恢复整个拒绝，一个字节都不落
    target.files.set(
      "manifest.json",
      new TextEncoder().encode(JSON.stringify({ schemaVersion: 1, files: [{ path: "../evil.txt", size: 1, mtime: 1 }], updatedAt: 1 })),
    );
    await assert.rejects(
      () => restoreVaultFromCloud(target as never, join(root, "restore-evil"), { dryRun: true }),
      /非法路径/,
    );
    assert.equal(existsSync(join(root, "restore-evil")), false);
    assert.equal(existsSync(join(root, "evil.txt")), false);
  } finally {
    store.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("state 损坏容错：坏 JSON 按空态处理", () => {
  const root = mkdtempSync(join(tmpdir(), "kami-cb-state-"));
  const store = openVaultStore(root);
  try {
    mkdirSync(join(root, ".data", "backups"), { recursive: true });
    writeCloudStored(null, root);
    assert.equal(readCloudStored(root), null);
    writeFileSync(join(root, ".data", "backups", "backup-state.json"), "{oops");
    const state = readBackupState(root);
    assert.equal(state.running, false);
    assert.equal(state.snapshots.length, 0);
  } finally {
    store.close();
    rmSync(root, { recursive: true, force: true });
  }
});
