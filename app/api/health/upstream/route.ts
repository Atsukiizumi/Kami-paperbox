import { GET as getHealthUpstream } from "@/routes/api/health-upstream";
import { withDataPlane } from "@/lib/next-route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// guest 显式不放行（TD-20 教训，任何新 /api 路由都要显式决策 guest）：
// 上游失败细节（哪些站、什么错）属个人面读数，访客与局域网匿名设备不可见；
// 应用账号未配置形态下仍需启动令牌配对。
export const GET = withDataPlane(getHealthUpstream);
