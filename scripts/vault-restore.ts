/**
 * 云端恢复脚本：把云备份目录拉回本机纸匣。
 *
 * 用法：
 *   node --experimental-strip-types scripts/vault-restore.ts            # 计划预览（不动盘）
 *   node --experimental-strip-types scripts/vault-restore.ts --yes      # 真恢复（覆盖 vault.sqlite 与 files）
 *   node --experimental-strip-types scripts/vault-restore.ts --yes --dir < Kami 根目录 >
 *
 * 前提：应用已停止（脚本会覆盖 .data/vault/vault.sqlite）；连接信息在
 * .data/backups/cloud-target.json（云备份卡里连过就有）。
 * 为什么：恢复是换机器/灾难场景的低频动作，文档化脚本即可，不做应用内 UI（拍板 out of scope）。
 */
import { join } from "node:path";
import { resolveKamiRoot } from "../src/lib/proxy.server.ts";
import { readCloudStored } from "../src/lib/storage/cloud-backup/config.server.ts";
import { createCloudTarget } from "../src/lib/storage/cloud-backup/targets.server.ts";
import { restoreVaultFromCloud } from "../src/lib/storage/cloud-backup/engine.server.ts";

const args = process.argv.slice(2);
const yes = args.includes("--yes");
const dirIdx = args.indexOf("--dir");
const root = dirIdx >= 0 ? (args[dirIdx + 1] ?? "") : resolveKamiRoot();

const stored = readCloudStored(root);
if (!stored) {
  console.error("没有找到云备份连接（.data/backups/cloud-target.json）。先在 设置 → 存储 → 云备份 里连接一次。");
  process.exit(1);
}
console.log(`云端：${stored.target.kind} · 目录 ${stored.target.remoteDir}`);

const target = createCloudTarget(stored.target);
const vaultDir = join(root, ".data", "vault");

if (!yes) {
  const dry = await restoreVaultFromCloud(target, vaultDir, { dryRun: true });
  console.log(`将恢复：目录快照 ${dry.snapshot ?? "（云端没有快照！）"} + ${dry.files} 个文件，共 ${dry.bytes} 字节`);
  console.log(`目标：${vaultDir}（覆盖 vault.sqlite 与 files/）`);
  console.log("确认无误后加 --yes 再跑一次。建议先停掉应用。");
  process.exit(0);
}

const result = await restoreVaultFromCloud(target, vaultDir);
console.log(`已恢复：快照 ${result.snapshot} · ${result.files} 个文件 · ${result.bytes} 字节 → ${vaultDir}`);
console.log("现在可以重新启动应用了。");
