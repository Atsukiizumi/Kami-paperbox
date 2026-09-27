import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DEFAULT_CLOUD_CONFIG,
  DEFAULT_REMOTE_DIR,
  isInsecureUrlBlocked,
  maskCloudTarget,
  parseCloudConfig,
  parseCloudTarget,
  parseRemoteDir,
} from "./types.ts";

test("parseRemoteDir：默认、去首尾斜杠、坏输入回默认", () => {
  assert.equal(parseRemoteDir(undefined), DEFAULT_REMOTE_DIR);
  assert.equal(parseRemoteDir(""), DEFAULT_REMOTE_DIR);
  assert.equal(parseRemoteDir("/kami/backup/"), "kami/backup");
  assert.equal(parseRemoteDir("..\\"), DEFAULT_REMOTE_DIR, "点段/反斜杠爬路径回默认");
  assert.equal(parseRemoteDir("a/../../b"), DEFAULT_REMOTE_DIR);
  assert.equal(parseRemoteDir("x".repeat(81)), DEFAULT_REMOTE_DIR, "超长段回默认");
  assert.equal(parseRemoteDir("纸匣/备份"), "纸匣/备份", "中日文段允许");
});

test("isInsecureUrlBlocked：明文 http 只对回环豁免", () => {
  assert.equal(isInsecureUrlBlocked(new URL("http://192.168.1.5:5000")), true);
  assert.equal(isInsecureUrlBlocked(new URL("http://dav.example.com")), true);
  assert.equal(isInsecureUrlBlocked(new URL("http://localhost:8080")), false);
  assert.equal(isInsecureUrlBlocked(new URL("http://127.0.0.1:9000")), false);
  assert.equal(isInsecureUrlBlocked(new URL("https://dav.example.com")), false);
});

test("parseCloudTarget：webdav 校验与补斜杠", () => {
  const ok = parseCloudTarget({
    kind: "webdav",
    url: "https://dav.jianguoyun.com/dav",
    username: " me ",
    password: "pw",
    remoteDir: "kami",
  });
  assert.equal(ok?.kind, "webdav");
  assert.equal(ok?.kind === "webdav" && ok.url, "https://dav.jianguoyun.com/dav/");
  assert.equal(ok?.kind === "webdav" && ok.username, "me");

  assert.equal(parseCloudTarget({ kind: "webdav", url: "http://dav.example.com", username: "a", password: "b" }), null, "非回环明文 http 拒绝");
  assert.equal(parseCloudTarget({ kind: "webdav", url: "https://dav.example.com", username: "a" }), null, "缺密码拒绝");
  assert.equal(parseCloudTarget({ kind: "webdav", url: "not a url", username: "a", password: "b" }), null);
  assert.equal(parseCloudTarget({ kind: "webdav", url: "https://d.example.com", username: "a\nb", password: "b" }), null, "控制字符拒绝");
});

test("parseCloudTarget：s3 校验", () => {
  const ok = parseCloudTarget({
    kind: "s3",
    endpoint: "https://acc.r2.cloudflarestorage.com",
    region: "",
    bucket: "kami",
    accessKeyId: "AK",
    secretAccessKey: "SK",
  });
  assert.equal(ok?.kind, "s3");
  assert.equal(ok?.kind === "s3" && ok.region, "auto", "空 region 回 auto");

  assert.equal(
    parseCloudTarget({ kind: "s3", endpoint: "https://x.com", bucket: "bad bucket!", accessKeyId: "a", secretAccessKey: "b" }),
    null,
    "bucket 名带非法字符拒绝",
  );
  assert.equal(parseCloudTarget({ kind: "s3", endpoint: "https://x.com", bucket: "b" }), null, "缺密钥拒绝");
  assert.equal(parseCloudTarget({ kind: "nope" }), null);
});

test("parseCloudConfig：范围与默认", () => {
  assert.deepEqual(parseCloudConfig({ enabled: true, intervalHours: 24, keep: 14 }), { enabled: true, intervalHours: 24, keep: 14 });
  assert.equal(parseCloudConfig({ enabled: true, intervalHours: 0, keep: 14 }), null, "间隔下限");
  assert.equal(parseCloudConfig({ enabled: true, intervalHours: 169, keep: 14 }), null, "间隔上限");
  assert.equal(parseCloudConfig({ enabled: true, intervalHours: 24, keep: 0 }), null, "保留下限");
  assert.equal(parseCloudConfig({ enabled: "yes", intervalHours: 24, keep: 14 }), null, "开关必须是布尔");
  assert.deepEqual(DEFAULT_CLOUD_CONFIG.enabled, false, "默认不开启（拍板）");
});

test("maskCloudTarget：只露 kind/host/目录，不露凭据", () => {
  const t = parseCloudTarget({ kind: "webdav", url: "https://dav.example.com/dav/", username: "u", password: "secret", remoteDir: "kami" })!;
  const masked = maskCloudTarget(t) as Record<string, unknown>;
  assert.deepEqual(masked, { kind: "webdav", host: "dav.example.com", remoteDir: "kami" });
  assert.equal(JSON.stringify(masked).includes("secret"), false);
});
