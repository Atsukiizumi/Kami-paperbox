import { POST as postWhoami } from "@/routes/api/whoami";
import { withDataPlane } from "@/lib/next-route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 访客层（TD-20）：cookie 进 body、公开 profile 出，不含服务端个人数据；
// 空 cookie 在 site-identity 层早退、不打上游。
export const POST = withDataPlane(postWhoami, { guest: true });
