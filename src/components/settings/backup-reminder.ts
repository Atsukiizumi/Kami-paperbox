/**
 * 备份过期判定（纯函数）。
 *
 * 作用：存储分区笺条——距上次成功导出超过 30 天就提醒去「备份」分区。
 * 用法：settings/storage.tsx 渲染；同目录 .test.tsx 锁定口径。
 * 为什么：时间全部显式传参，测试不碰系统时钟；口径单点收敛在这里，
 *        组件只管展示。
 *
 * 口径：lastBackupAt 为 null（从未备份过）**不算**超期——「没备过」和
 * 「备得太久」是两件事，前者只给一行「尚未备份过」小字，不弹笺条 nag。
 * 恰好 30 天当天不算超期，超过 30 天才算（严格大于）。
 */

export const BACKUP_OVERDUE_DAYS = 30;

const BACKUP_OVERDUE_MS = BACKUP_OVERDUE_DAYS * 24 * 60 * 60 * 1000;

export function isBackupOverdue(lastBackupAt: number | null, now: number): boolean {
  if (lastBackupAt === null || !Number.isFinite(lastBackupAt)) return false;
  return now - lastBackupAt > BACKUP_OVERDUE_MS;
}
