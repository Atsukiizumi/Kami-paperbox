import assert from "node:assert/strict";
import { test } from "node:test";
import { BACKUP_FORMAT, BACKUP_FORMAT_V2, buildBackup, mergeVaultRecords, parseBackup, parseBackupFile, parseBackupSettings, parseVaultRecords, preserveClientVaultFields } from "./backup.ts";
import { deriveBoxKey, openJson, randomSaltB64, sealJson, type CipherBox } from "./crypto-box.ts";
import type { SmartFolder } from "./vault-query.ts";
import type { WatchArtist } from "../watch.ts";

const FAKE_SESSION = "11111111_testhashvalue";

function sampleSettings() {
  return {
    pixivCookie: FAKE_SESSION,
    smartFolders: [{ id: "f1", name: "样例", query: { tags: ["1girl"] } }],
    authorAliases: { あいす: "アイス", "☆古河渚★": "古河渚" },
    tagAliases: { 鳴潮: "鸣潮", Waves: "鸣潮" },
    watchArtists: [],
    watchLimit: 100,
    watchTags: [{ source: "pixiv" as const, tag: "鳴潮", addedAt: 1, lastSeenId: "900" }],
    fanboxCookie: FAKE_SESSION,
    danbooruLogin: "demo",
    danbooruApiKey: "db-key",
    safeModeBySite: { pixiv: false, fanbox: false, yande: false, konachan: false, danbooru: false },
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
    uiStyle: "hand" as const,
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
  assert.deepEqual(parsed.backup.settings.authorAliases, { あいす: "アイス", "☆古河渚★": "古河渚" });
  assert.deepEqual(parsed.backup.settings.safeModeBySite, {
    pixiv: false,
    fanbox: false,
    yande: false,
    konachan: false,
    danbooru: false,
  });
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

// ── v2 加密格式（SEC-03）────────────────────────────────────────────────────

test("v2：加密文件无口令报明确错误，带 opener 解开与明文等价", async () => {
  const salt = randomSaltB64();
  const key = await deriveBoxKey("pw", salt);
  const plain = buildBackup({ settings: { ...sampleSettings(), pixivCookie: "PHPSESSID=secret" }, vault: [], now: 123 });
  const cipher = await sealJson(key, { settings: plain.settings, proxyUrl: plain.proxyUrl }, salt);
  const file = { ...plain, format: BACKUP_FORMAT_V2, settings: undefined, proxyUrl: undefined, settingsCipher: cipher };

  const noPass = parseBackup(file);
  assert.equal(noPass.ok, false);
  assert.match(noPass.error, /口令/);

  const withPass = await parseBackupFile(file, {
    open: async (box: CipherBox) => openJson<{ settings: unknown }>(await deriveBoxKey("pw", box.salt, box.iter), box),
  });
  assert.equal(withPass.ok, true);
  // 凭据字段会经多账号提升/清洗改写，断言不参与清洗的普通字段证明「整段往返」无损
  if (withPass.ok) {
    assert.equal(withPass.backup.settings.folderLabel, plain.settings.folderLabel);
    assert.equal(withPass.backup.settings.pathTemplate, plain.settings.pathTemplate);
    assert.equal(typeof withPass.backup.settings.pixivCookie, "string");
  }

  const wrongPass = await parseBackupFile(file, {
    open: async (box: CipherBox) => openJson(await deriveBoxKey("bad", box.salt, box.iter), box),
  });
  assert.equal(wrongPass.ok, false);
  assert.match(String(wrongPass.error), /口令不对|失败/);
});

test("v1 明文文件不受 v2 影响", () => {
  const v1 = buildBackup({ settings: sampleSettings(), vault: [], now: 5 });
  const parsed = parseBackup(JSON.parse(JSON.stringify(v1)));
  assert.equal(parsed.ok, true);
});

test("smartFolders 随备份往返（智能库）", () => {
  const folders: SmartFolder[] = [
    { id: "f1", name: "风景", query: { tags: ["landscape"], month: "2026-08" } },
    { id: "f2", name: "画师", query: { author: "zero", source: "pixiv" } },
  ];
  const backup = buildBackup({
    settings: {
      ...parseBackupSettings({}),
      smartFolders: folders,
    },
  });
  assert.deepEqual(backup.settings.smartFolders, folders);
  const parsed = parseBackup(JSON.parse(JSON.stringify(backup)));
  assert.ok(parsed.ok);
  assert.deepEqual((parsed.backup as { settings: { smartFolders: typeof folders } }).settings.smartFolders, folders);
  // 脏数据 → 空数组不连坐
  const dirty = parseBackupSettings({ smartFolders: [{ id: 1 }, "junk"] });
  assert.deepEqual(dirty.smartFolders, []);
});

test("watchArtists/watchLimit 随备份往返（追踪）", () => {
  const artists: WatchArtist[] = [{ source: "pixiv", id: "11", name: "画师", avatar: "https://i.pximg.net/a.jpg", addedAt: 1, lastSeenId: "900" }];
  const backup = buildBackup({
    settings: { ...sampleSettings(), watchArtists: artists, watchLimit: 50 },
  });
  assert.deepEqual(backup.settings.watchArtists, artists);
  assert.equal(backup.settings.watchLimit, 50);
  const parsed = parseBackup(JSON.parse(JSON.stringify(backup)));
  assert.ok(parsed.ok);
  const settings = (parsed.backup as { settings: { watchArtists: typeof artists; watchLimit: number } }).settings;
  assert.deepEqual(settings.watchArtists, artists);
  assert.equal(settings.watchLimit, 50);
});

test("authorAliases 随备份往返（画师名整理）；缺段补空、脏项裁剪", () => {
  const aliases = { "user@pixiv": "user", アイス: "あいす" };
  const backup = buildBackup({ settings: { ...sampleSettings(), authorAliases: aliases } });
  assert.deepEqual(backup.settings.authorAliases, aliases);
  const parsed = parseBackup(JSON.parse(JSON.stringify(backup)));
  assert.ok(parsed.ok);
  assert.deepEqual(parsed.backup.settings.authorAliases, aliases);
  // 老备份（无该段）→ 空 {},不连坐
  assert.deepEqual(parseBackupSettings({}).authorAliases, {});
  // 脏数据 → 坏项丢弃（值=键、空值），好项保留
  assert.deepEqual(parseBackupSettings({ authorAliases: { a: "a", "": "x", ok: " 好 " } }).authorAliases, { ok: "好" });
});

test("tagAliases 随备份往返（标签整理）；缺段补空、脏项与成链裁剪", () => {
  const aliases = { 鳴潮: "鸣潮", Waves: "鸣潮" };
  const backup = buildBackup({ settings: { ...sampleSettings(), tagAliases: aliases } });
  assert.deepEqual(backup.settings.tagAliases, aliases);
  const parsed = parseBackup(JSON.parse(JSON.stringify(backup)));
  assert.ok(parsed.ok);
  assert.deepEqual(parsed.backup.settings.tagAliases, aliases);
  // 老备份（无该段）→ 空 {},不连坐
  assert.deepEqual(parseBackupSettings({}).tagAliases, {});
  // 脏数据 → 坏项丢弃（值=键、空值、非字符串值），好项保留
  assert.deepEqual(parseBackupSettings({ tagAliases: { a: "a", "": "x", bad: null, ok: " 好 " } }).tagAliases, { ok: "好" });
  // 成链条目丢弃：鳴潮→鸣潮 撞上键「鸣潮」
  assert.deepEqual(
    parseBackupSettings({ tagAliases: { 鳴潮: "鸣潮", 鸣潮: "WutheringWaves" } }).tagAliases,
    { 鸣潮: "WutheringWaves" },
  );
});

test("safeModeBySite：新档逐站往返，旧档 safeMode 广播到五站，缺/脏回安全侧", () => {
  // v13 新档：逐站点值原样保留
  const perSite = { pixiv: true, fanbox: false, yande: true, konachan: false, danbooru: true };
  assert.deepEqual(parseBackupSettings({ safeModeBySite: perSite }).safeModeBySite, perSite);
  // v13 前旧备份：只有全局 safeMode → 广播到五站
  assert.deepEqual(parseBackupSettings({ safeMode: false }).safeModeBySite, {
    pixiv: false,
    fanbox: false,
    yande: false,
    konachan: false,
    danbooru: false,
  });
  assert.deepEqual(parseBackupSettings({ safeMode: true }).safeModeBySite, {
    pixiv: true,
    fanbox: true,
    yande: true,
    konachan: true,
    danbooru: true,
  });
  // 新记录缺站点：用旧全局值兜底，两端都缺回安全侧
  assert.deepEqual(parseBackupSettings({ safeMode: false, safeModeBySite: { pixiv: true } }).safeModeBySite, {
    pixiv: true,
    fanbox: false,
    yande: false,
    konachan: false,
    danbooru: false,
  });
  assert.deepEqual(parseBackupSettings({}).safeModeBySite, {
    pixiv: true,
    fanbox: true,
    yande: true,
    konachan: true,
    danbooru: true,
  });
  // 脏值当缺省
  assert.equal(parseBackupSettings({ safeModeBySite: { pixiv: "no" } }).safeModeBySite.pixiv, true);
});

test("vault 记录 aiType 随备份往返（卡牌 AI 标识），缺省不落字段", () => {
  const backup = buildBackup({
    settings: sampleSettings(),
    vault: [{ ...sampleVault()[0]!, aiType: 2 }],
  });
  assert.equal(backup.vault[0]?.aiType, 2);
  const parsed = parseBackup(JSON.parse(JSON.stringify(backup)));
  assert.ok(parsed.ok);
  assert.equal(parsed.backup.vault[0]?.aiType, 2);
  // 旧档没有 aiType：字段缺席，不补 0
  const legacy = parseVaultRecords([sampleVault()[0]]);
  assert.equal(legacy[0]?.aiType, undefined);
  // 脏值丢弃
  assert.equal(parseVaultRecords([{ ...sampleVault()[0]!, aiType: "x" }])[0]?.aiType, undefined);
});

test("watchTags 随备份往返（标签订阅）；缺段补空、脏项裁剪", () => {
  const tags = [{ source: "pixiv" as const, tag: "鳴潮", addedAt: 1, lastSeenId: "900" }];
  const backup = buildBackup({ settings: { ...sampleSettings(), watchTags: tags } });
  assert.deepEqual(backup.settings.watchTags, tags);
  const parsed = parseBackup(JSON.parse(JSON.stringify(backup)));
  assert.ok(parsed.ok);
  assert.deepEqual(parsed.backup.settings.watchTags, tags);
  // 老备份（无该段）→ 空 []，不连坐；脏项丢弃
  assert.deepEqual(parseBackupSettings({}).watchTags, []);
  assert.deepEqual(
    parseBackupSettings({ watchTags: [{ source: "fanbox", tag: "x" }, { source: "yande", tag: " 好 " }] }).watchTags.map((t) => t.tag),
    ["好"],
  );
});

test("vault 记录 xRestrict/rating 随备份往返；mergeVaultRecords 远端缺字段保留本地", () => {
  const withFlags = { ...sampleVault()[0]!, xRestrict: 2, rating: undefined };
  const backup = buildBackup({ settings: sampleSettings(), vault: [withFlags] });
  assert.equal(backup.vault[0]?.xRestrict, 2);
  const parsed = parseBackup(JSON.parse(JSON.stringify(backup)));
  assert.ok(parsed.ok);
  assert.equal(parsed.backup.vault[0]?.xRestrict, 2);
  assert.equal(parseVaultRecords([{ ...sampleVault()[0]!, rating: "e" }])[0]?.rating, "e");
  assert.equal(parseVaultRecords([{ ...sampleVault()[0]!, xRestrict: "x" }])[0]?.xRestrict, undefined, "脏值丢弃");
  // 合并守卫：远端行（服务端不携带客户端先行字段）覆盖时保留本地分级/AI 标记
  const local = [{ ...sampleVault()[0]!, aiType: 2, xRestrict: 1, rating: "e" }];
  const incoming = [{ ...sampleVault()[0]!, title: "远端更新" }];
  const merged = mergeVaultRecords(local, incoming);
  assert.equal(merged[0]?.title, "远端更新", "远端目录字段照常覆盖");
  assert.equal(merged[0]?.aiType, 2, "本地 AI 标记不清空");
  assert.equal(merged[0]?.xRestrict, 1, "本地分级不清空");
  assert.equal(merged[0]?.rating, "e", "本地 rating 不清空");
});

test("preserveClientVaultFields：vault 同步段写回守卫（applySegment 用），远端缺三字段保留本地", () => {
  // 远端行：服务端列锁不带 aiType/xRestrict/rating
  const remote = { ...sampleVault()[0]!, title: "远端目录" };
  const local = { ...sampleVault()[0]!, aiType: 2, xRestrict: 1, rating: "e" };
  const kept = preserveClientVaultFields(remote, local);
  assert.equal(kept.title, "远端目录", "远端目录字段照常应用");
  assert.equal(kept.aiType, 2, "本地 AI 标记保留");
  assert.equal(kept.xRestrict, 1, "本地分级保留");
  assert.equal(kept.rating, "e", "本地 rating 保留");
  // 远端带了明确值（新备份文件导入）：以远端为准
  const fresh = preserveClientVaultFields({ ...remote, xRestrict: 2 }, local);
  assert.equal(fresh.xRestrict, 2, "远端显式值覆盖");
  // 无本地行（新设备首拉）：字段缺席不补假值
  const none = preserveClientVaultFields(remote, undefined);
  assert.equal(none.aiType, undefined);
  assert.equal(none.xRestrict, undefined);
});
