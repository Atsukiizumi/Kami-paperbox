import { POST as postSearchByImage } from "@/routes/api/vault-search-by-image";
import { withDataPlane } from "@/lib/next-route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 不传 guest：搜的是用户自己的纸匣，个人面（与 app/api/vault/dedup 同口径）；
// 访客请求在闸门处 401。
export const POST = withDataPlane(postSearchByImage);
