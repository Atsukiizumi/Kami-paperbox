import { GET as getThemeAsset } from "@/routes/api/themes/asset";
import { withDataPlane } from "@/lib/next-route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withDataPlane(getThemeAsset, { guest: "read" });
