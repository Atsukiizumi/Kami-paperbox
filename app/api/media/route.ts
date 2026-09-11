import { GET as getMedia } from "@/routes/api/media";
import { withDataPlane } from "@/lib/next-route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withDataPlane(getMedia, { guest: true });
