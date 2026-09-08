import assert from "node:assert/strict";
import { test } from "node:test";
import { BACKUP_FORMAT, buildBackup, mergeVaultRecords, parseBackup } from "./backup.ts";

const FAKE_SESSION = "11111111_testhashvalue";

function sampleSettings() {
  return {
    pixivCookie: FAKE_SESSION,
    fanboxCookie: FAKE_SESSION,
    safeMode: false,
    hideAi: true,
    downloadOriginal: true,
    vaultMirrorFolder: true,
    downloadToFolder: false,
    pathPreset: "author" as const,
    pathTemplate: "{author}/{id}.{ext}",
    folderLabel: "Kami",
    tab: "yande" as const,
    searchEngine: "iqdb" as const,
    saucenaoApiKey: "demo-key",
    recents: ["hatsune_miku"],
    savedTags: {
      pixiv: ["オリジナル"],
      fanbox: [],
      yande: ["landscape"],
      konachan: [],
      danbooru: [],
    },
    accounts: [
      {
        id: "acc-1",
        name: "主号",
        pixivCookie: FAKE_SESSION,
        fanboxCookie: FAKE_SESSION,
        pixivProfile: { id: "11111111", name: "demo" },
        fanboxProfile: null,
      },
    ],
    activeAccountId: "acc-1",
    theme: "shusha" as const,
    appearance: "light" as const,
    onboarded: true,
  };
}

function sampleVault() {
  return [
    {
      key: "pixiv:99",
      source: "pixiv" as const,
      id: "99",
      title: "demo work",
      author: "demo",
      authorId: "1",
      tags: ["オリジナル"],
      pageCount: 2,
      savedAt: 1_700_000_000_000,
      bytes: 12,
      relativePath: "demo/99.jpg",
      folderLabel: "Kami",
    },
  ];
}

test("buildBackup round-trips settings, accounts, and vault records", () => {
  const built = buildBackup({
    settings: sampleSettings(),
    vault: sampleVault(),
    lexicon: [{ en: "1girl", zh: "单女" }],
    catalog: [{ en: "1girl", count: 3, lastSeen: 1, sites: ["yande"] }],
    history: {
      items: [
        {
          source: "pixiv",
          id: "99",
          title: "demo work",
          author: "demo",
          authorId: "1",
          thumb: "",
          pageCount: 1,
          viewedAt: 1_700_000_000_000,
        },
      ],
      authors: [{ source: "pixiv", id: "1", name: "demo", avatar: "", viewedAt: 1_700_000_000_000 }],
    },
    proxyUrl: "http://127.0.0.1:7890",
    now: 1_800_000_000_000,
  });
  assert.equal(built.format, BACKUP_FORMAT);
  assert.equal(built.exportedAt, 1_800_000_000_000);
  const parsed = parseBackup(JSON.parse(JSON.stringify(built)));
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.equal(parsed.backup.settings.accounts[0]?.pixivCookie, FAKE_SESSION);
  assert.equal(parsed.backup.settings.activeAccountId, "acc-1");
  assert.equal(parsed.backup.settings.theme, "shusha");
  assert.equal(parsed.backup.vault[0]?.key, "pixiv:99");
  assert.equal(parsed.backup.vault[0]?.relativePath, "demo/99.jpg");
  assert.equal(parsed.backup.lexicon[0]?.zh, "单女");
  assert.equal(parsed.backup.catalog[0]?.en, "1girl");
  assert.equal(parsed.backup.history.items[0]?.id, "99");
  assert.equal(parsed.backup.proxyUrl, "http://127.0.0.1:7890");
});

test("parseBackup rejects unknown files", () => {
  const bad = parseBackup({ format: "nope", settings: {} });
  assert.equal(bad.ok, false);
  if (bad.ok) return;
  assert.match(bad.error, /备份/);
});

test("parseBackup drops invalid vault keys and keeps the rest", () => {
  const parsed = parseBackup({
    format: BACKUP_FORMAT,
    exportedAt: 1,
    settings: sampleSettings(),
    vault: [
      sampleVault()[0],
      { key: "pixiv:../etc", source: "pixiv", id: "../etc", title: "bad", author: "", authorId: "", tags: [], pageCount: 1, savedAt: 1, bytes: 0 },
    ],
  });
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.equal(parsed.backup.vault.length, 1);
  assert.equal(parsed.backup.vault[0]?.id, "99");
});

test("mergeVaultRecords lets incoming records overwrite the same key", () => {
  const current = sampleVault();
  const incoming = [
    { ...current[0]!, title: "updated", savedAt: 2 },
    {
      key: "yande:1",
      source: "yande" as const,
      id: "1",
      title: "other",
      author: "z",
      authorId: "",
      tags: [],
      pageCount: 1,
      savedAt: 3,
      bytes: 1,
    },
  ];
  const merged = mergeVaultRecords(current, incoming);
  assert.equal(merged.length, 2);
  assert.equal(merged.find((row) => row.key === "pixiv:99")?.title, "updated");
  assert.equal(merged.find((row) => row.key === "yande:1")?.id, "1");
});
