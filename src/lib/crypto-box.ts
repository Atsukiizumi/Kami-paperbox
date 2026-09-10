/**
 * 口令加密容器（SEC-03）：PBKDF2-HMAC-SHA256 派生 + AES-256-GCM。
 *
 * 作用：备份文件 / 账号同步里的「设置」段（含各图站登录凭据、代理地址）
 *      加密后再落盘或外发——拿到文件/磁盘的人没有口令就读不到会话。
 * 用法：sealJson/openJson 成对；密钥由口令 + 每个容器自己的随机 salt 派生，
 *      salt 随密文一起存（不是秘密，只保证每份容器密钥独立）。
 * 为什么选这组参数：WebCrypto 原生支持（Node 22 / 浏览器同构，可单测）；
 *      21 万轮 PBKDF2-SHA256 是 OWASP 2023+ 对 AES-GCM 的推荐下限，
 *      AES-GCM 自带完整性校验，口令错 = 解密失败，无需另做认证。
 */
export type CipherBox = {
  v: 1;
  kdf: "PBKDF2-SHA256";
  iter: number;
  salt: string;
  iv: string;
  ct: string;
};

const DEFAULT_ITER = 210_000;

function toB64(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

function fromB64(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
}

export function randomSaltB64(): string {
  const salt = new Uint8Array(16);
  crypto.getRandomValues(salt);
  return toB64(salt);
}

/** 从口令派生 AES-GCM 256 密钥。salt/iter 必须与封存时一致。 */
export async function deriveBoxKey(passphrase: string, saltB64: string, iter = DEFAULT_ITER): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey("raw", new TextEncoder().encode(passphrase), "PBKDF2", false, [
    "deriveKey",
  ]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: fromB64(saltB64) as BufferSource, iterations: iter, hash: "SHA-256" },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

/** 封存任意可 JSON 化的值为加密容器。 */
export async function sealJson(key: CryptoKey, value: unknown, saltB64: string): Promise<CipherBox> {
  const iv = new Uint8Array(12);
  crypto.getRandomValues(iv);
  const ct = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: iv as BufferSource },
    key,
    new TextEncoder().encode(JSON.stringify(value)),
  );
  return { v: 1, kdf: "PBKDF2-SHA256", iter: DEFAULT_ITER, salt: saltB64, iv: toB64(iv), ct: toB64(new Uint8Array(ct)) };
}

/** 打开容器；口令不对抛错（GCM 校验失败）。 */
export async function openJson<T>(key: CryptoKey, box: CipherBox): Promise<T> {
  if (box.v !== 1 || box.kdf !== "PBKDF2-SHA256") throw new Error("不认识的加密格式");
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: fromB64(box.iv) as BufferSource },
    key,
    fromB64(box.ct) as BufferSource,
  );
  return JSON.parse(new TextDecoder().decode(plain)) as T;
}
