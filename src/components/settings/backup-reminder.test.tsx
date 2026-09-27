/**
 * isBackupOverdue()（备份过期判定）就地测试。
 */
import "../../test/dom.ts";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { BACKUP_OVERDUE_DAYS, effectiveLastBackupAt, isBackupOverdue } from "./backup-reminder.ts";

const DAY = 24 * 60 * 60 * 1000;

describe("settings/storage backup-reminder（备份过期判定）", () => {
  it("null（从未备份）不算超期，只配小字提示不弹笺条", () => {
    assert.equal(isBackupOverdue(null, 1_000_000_000), false);
  });
  it("刚备份过不算超期", () => {
    assert.equal(isBackupOverdue(1_000_000_000, 1_000_000_000 + DAY), false);
  });
  it(`恰好 ${BACKUP_OVERDUE_DAYS} 天不算超期（严格大于）`, () => {
    assert.equal(isBackupOverdue(1_000_000_000, 1_000_000_000 + BACKUP_OVERDUE_DAYS * DAY), false);
  });
  it("超过 30 天 1ms 即超期", () => {
    assert.equal(
      isBackupOverdue(1_000_000_000, 1_000_000_000 + BACKUP_OVERDUE_DAYS * DAY + 1),
      true,
    );
  });
  it("远超 30 天算超期", () => {
    assert.equal(isBackupOverdue(1_000_000_000, 1_000_000_000 + 90 * DAY), true);
  });
  it("非法时间戳当从未备份处理，不超期", () => {
    assert.equal(isBackupOverdue(Number.NaN, 1_000_000_000), false);
  });
});

// ── 云备份合流：effectiveLastBackupAt ──────────────────────────────────────

describe("effectiveLastBackupAt", () => {
  it("取手动与云备份里更近的那次", () => {
    assert.equal(effectiveLastBackupAt(1_000, 2_000), 2_000);
    assert.equal(effectiveLastBackupAt(3_000, 2_000), 3_000);
  });

  it("单边有值用单边；双方都空返回 null", () => {
    assert.equal(effectiveLastBackupAt(null, 2_000), 2_000);
    assert.equal(effectiveLastBackupAt(1_000, null), 1_000);
    assert.equal(effectiveLastBackupAt(null, null), null);
  });

  it("非有限数字按 null 处理", () => {
    assert.equal(effectiveLastBackupAt(Number.NaN as unknown as number, 5_000), 5_000);
    assert.equal(effectiveLastBackupAt(1_000, Number.NaN as unknown as number), 1_000);
    assert.equal(effectiveLastBackupAt(Number.NaN as unknown as number, Number.NaN as unknown as number), null);
  });
});
