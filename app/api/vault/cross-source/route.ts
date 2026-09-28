import { GET as getCrossSource } from "@/routes/api/vault-cross-source";
import { withDataPlane } from "@/lib/next-route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 不传 guest：同图多源是收藏管理动作，个人面（与 app/api/vault/dedup 同口径）。
export const GET = withDataPlane(getCrossSource);
