import { withDataPlane } from "@/lib/next-route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 存储占用聚合（works.bytes 的 SQL GROUP BY，个人面只读）。 */
export const GET = withDataPlane(async () => {
  try {
    const { getVaultStore } = await import("@/lib/vault-store.server");
    const store = getVaultStore();
    return Response.json(
      { ok: true, bySource: store.storageBy("source"), byAuthor: store.storageBy("author") },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (err) {
    return Response.json(
      { ok: false, error: err instanceof Error ? err.message : "存储统计不可用" },
      { status: 500, headers: { "cache-control": "no-store" } },
    );
  }
});
