/**
 * 上游 fixtures 读取器（M1 测试双模式）。
 *
 * 作用：给 mapping 族测试读 tests/fixtures/upstream/ 下的真实响应快照
 *      （fetch-upstream-fixtures.mjs 的产物，{_meta, data} 包裹，本 loader
 *      只交出 data）；fixture 缺失或损坏时返回 null，消费方回退内联样本。
 * 用法：loadUpstreamFixture("yandere_post.json") ?? 内联样本。
 * 为什么：仓库 clone 即 hermetic——快照会过时，但过时 ≠ 不可用（上游真正
 *      改版时 mapping 断言自己会红），所以超过 90 天只 console.warn 提醒
 *      跑一次刷新脚本，绝不因快照陈旧而 fail。
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** 90 天 = 一个上游改版周期的量级；只告警不失败，hermetic 优先。 */
const STALE_AFTER_MS = 90 * 24 * 60 * 60 * 1000;

/**
 * @param {string} name fixtures 目录下的文件名（如 "yandere_post.json"）
 * @returns {unknown} 快照 data 字段；无 fixture / 损坏时 null
 */
export function loadUpstreamFixture(name: string): unknown {
  try {
    const path = join(dirname(fileURLToPath(import.meta.url)), name);
    const parsed = JSON.parse(readFileSync(path, "utf8")) as {
      _meta?: { fetchedAt?: string };
      data?: unknown;
    };
    const fetchedAt = Date.parse(parsed._meta?.fetchedAt ?? "");
    if (Number.isFinite(fetchedAt) && Date.now() - fetchedAt > STALE_AFTER_MS) {
      console.warn(
        `[fixtures:staleness] ${name} 快照已超过 90 天（${parsed._meta?.fetchedAt}）——可跑 scripts/fetch-upstream-fixtures.mjs 刷新`,
      );
    }
    return parsed.data ?? null;
  } catch {
    return null; // 无 fixture / 损坏：消费方回退内联样本
  }
}
