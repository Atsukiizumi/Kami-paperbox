import { POST as postSessions } from "@/routes/api/sessions";
import { withDataPlane } from "@/lib/next-route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 访客层（TD-20）：写的是请求方自己浏览器的 HttpOnly 镜像 cookie（per-browser
// 无跨用户面），/api/media 的图站凭据通道靠它——不放行则访客 FANBOX/R-18 图挂。
export const POST = withDataPlane(postSessions, { guest: true });
