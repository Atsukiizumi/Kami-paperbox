/**
 * 各账号的图站凭据，只留在服务端。
 *
 * 浏览器不再保存原文。当前账号的副本在 HttpOnly cookie 里；
 * 切换账号时从这里读出，写进 cookie。文件用本机密钥加密，
 * 不进设置同步段。
 */
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getLogger } from "../log.server.ts";
import { resolveKamiRoot } from "../proxy.server.ts";

export type SiteSecrets = {
  pixiv: string;
  fanbox: string;
  x: string;
  danbooruLogin: string;
  danbooruApiKey: string;
};

type StoreFile = { v: 1; iv: string; tag: string; ct: string };

const KEY_NAME = "site-sessions.key";
const FILE_NAME = "site-sessions.json";

/**
 * 存储文件在、但解不开（密钥重建 / 位翻转 / 版本不认识）。
 * 读路径 fail-closed 抛出——把它当「空」会让下一次写把其余账号静默盖掉；
 * 写路径按重置处理（旧条目本就不可读，保住新写入优先于整体死锁）。
 */
export class SiteSessionsCorruptError extends Error {
  constructor() {
    super("site-sessions 存储损坏");
    this.name = "SiteSessionsCorruptError";
  }
}

export function emptySiteSecrets(): SiteSecrets {
  return { pixiv: "", fanbox: "", x: "", danbooruLogin: "", danbooruApiKey: "" };
}

function dataDir(root = resolveKamiRoot()): string {
  return join(root, ".data");
}

function loadKey(root: string): Buffer {
  const path = join(dataDir(root), KEY_NAME);
  try {
    const raw = readFileSync(path);
    if (raw.byteLength === 32) return raw;
  } catch {
    /* 新建 */
  }
  const key = randomBytes(32);
  mkdirSync(dataDir(root), { recursive: true });
  writeFileSync(path, key);
  return key;
}

function readStore(root: string): Record<string, SiteSecrets> {
  const path = join(dataDir(root), FILE_NAME);
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    return {};
  }
  try {
    const box = JSON.parse(raw) as StoreFile;
    if (box.v !== 1) throw new Error("unknown store version");
    const decipher = createDecipheriv("aes-256-gcm", loadKey(root), Buffer.from(box.iv, "base64"));
    decipher.setAuthTag(Buffer.from(box.tag, "base64"));
    const plain = Buffer.concat([decipher.update(Buffer.from(box.ct, "base64")), decipher.final()]).toString("utf8");
    const parsed = JSON.parse(plain) as { accounts?: Record<string, SiteSecrets> };
    return parsed.accounts ?? {};
  } catch {
    throw new SiteSessionsCorruptError();
  }
}

function writeStore(root: string, accounts: Record<string, SiteSecrets>): void {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", loadKey(root), iv);
  const ct = Buffer.concat([cipher.update(JSON.stringify({ accounts }), "utf8"), cipher.final()]);
  const box: StoreFile = { v: 1, iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64"), ct: ct.toString("base64") };
  const dir = dataDir(root);
  mkdirSync(dir, { recursive: true });
  const path = join(dir, FILE_NAME);
  writeFileSync(`${path}.tmp`, `${JSON.stringify(box)}\n`, "utf8");
  renameSync(`${path}.tmp`, path);
}

export function readAccountSecrets(accountId: string, root = resolveKamiRoot()): SiteSecrets | null {
  const row = readStore(root)[accountId];
  return row ? { ...emptySiteSecrets(), ...row } : null;
}

export function writeAccountSecrets(accountId: string, secrets: SiteSecrets, root = resolveKamiRoot()): void {
  let accounts: Record<string, SiteSecrets>;
  try {
    accounts = readStore(root);
  } catch (err) {
    if (!(err instanceof SiteSessionsCorruptError)) throw err;
    getLogger("site-sessions").warn("[site-sessions] 存储解不开，按重置写入（旧条目已不可读）");
    accounts = {};
  }
  accounts[accountId] = secrets;
  writeStore(root, accounts);
}

export function deleteAccountSecrets(accountId: string, root = resolveKamiRoot()): void {
  let accounts: Record<string, SiteSecrets>;
  try {
    accounts = readStore(root);
  } catch (err) {
    if (!(err instanceof SiteSessionsCorruptError)) throw err;
    // 删除本就是破坏性操作，损坏时重置等价于全部删掉
    getLogger("site-sessions").warn("[site-sessions] 存储解不开，删除视为整体重置");
    writeStore(root, {});
    return;
  }
  if (!(accountId in accounts)) return;
  delete accounts[accountId];
  writeStore(root, accounts);
}

/** 只覆盖出现过的字段。空字符串是清除，缺字段保持原值。 */
export function mergeSiteSecrets(current: SiteSecrets, patch: Partial<SiteSecrets>): SiteSecrets {
  return { ...current, ...patch };
}
