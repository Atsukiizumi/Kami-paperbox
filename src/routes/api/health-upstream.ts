/**
 * 上游健康读数（M2 可观测性）。
 *
 * 作用：读出站层内存环（upstream/health.server.ts），返回各 host 的
 *      调用数 / 成功率 / p50 延迟 / 最近一次失败，供设置页帮助区卡片轮询。
 * 用法：GET /api/health/upstream；app/api/health/upstream/route.ts 壳负责
 *      withDataPlane 包装。
 * 为什么：报障对账需要「图站到底最近怎么样」的一手读数；数据只来自本进程
 *      内存，读接口无副作用，no-store 防缓存串味。
 */
import { getUpstreamHealth } from "@/lib/upstream/health.server";

export async function GET() {
  return Response.json({ ok: true, ...getUpstreamHealth() }, {
    headers: { "cache-control": "no-store" },
  });
}
