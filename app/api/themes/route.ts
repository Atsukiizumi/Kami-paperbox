import { GET as getThemes, POST as postThemes } from "@/routes/api/themes";
import { withDataPlane } from "@/lib/next-route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 主题列表/资产是本机观感数据，读走 guest；导出/打开文件夹是本机写操作，要会话。
export const GET = withDataPlane(getThemes, { guest: "read" });
export const POST = withDataPlane(postThemes);
