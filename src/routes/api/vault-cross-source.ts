/**
 * 跨源同图簇 HTTP（个人面）。
 *
 * 作用：GET 现场重算跨源簇——list+hashes+dismissed 喂 crossSourceClusters，
 *      响应 { ok, clusters, hashed, total }（hashed/total 口径照 dedup 的
 *      groupsSummary）。无 POST scan：补算哈希复用 POST /api/vault/dedup
 *      {action:"scan"}，不重复造。
 * 用法：GET /api/vault/cross-source。为什么不开 guest：与查重同口径的收藏
 *      管理动作，个人面；服务端不可达时前端按钮隐身（照纸篓入口先例）。
 */
import { DUP_HASH_THRESHOLD } from "@/lib/storage/vault-dedup";
import { crossSourceClusters } from "@/lib/storage/vault-cross-source";
import { getVaultStore } from "@/lib/storage/vault-store.server";

function json(data: unknown, status = 200) {
  return Response.json(data, { status, headers: { "cache-control": "no-store" } });
}

export async function GET() {
  try {
    const store = getVaultStore();
    // hashes 只调一次：既作聚类输入也作覆盖计数
    const hashes = store.hashes();
    const clusters = crossSourceClusters(
      store.list().map(({ key, source }) => ({ key, source })),
      hashes,
      DUP_HASH_THRESHOLD,
      store.dismissedPairs(),
    );
    return json({ ok: true, clusters, hashed: hashes.length, total: store.list().length });
  } catch (err) {
    return json({ ok: false, error: err instanceof Error ? err.message : "跨源视图不可用" }, 500);
  }
}
