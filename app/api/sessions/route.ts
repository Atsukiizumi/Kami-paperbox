import { POST as postSessions } from "@/routes/api/sessions";
import { GUEST_SESSIONS_LIMIT } from "@/lib/guest-rate";
import { withDataPlane } from "@/lib/next-route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 访客层（TD-20）：写的是请求方自己浏览器的 HttpOnly 镜像 cookie（per-browser
// 无跨用户面），/api/media 的图站凭据通道靠它——不放行则访客 FANBOX/R-18 图挂。
// 访客不落服务端账号库（handler 内 switch/drop 403），另有进程内每分钟上限。
export const POST = withDataPlane(postSessions, {
  guest: true,
  guestRate: { bucket: "sessions", limit: GUEST_SESSIONS_LIMIT },
});
