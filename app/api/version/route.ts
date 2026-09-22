import { GET as getVersion } from "@/routes/api/version";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// guest 显式放行：版本号随公开镜像 tag / git 仓库可见，不属个人面数据；
// 升级探测是所有形态（本机 / Docker / LAN）共用的运维读数。
export const GET = getVersion;
