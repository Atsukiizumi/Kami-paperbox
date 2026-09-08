import { GET as getMedia } from "@/routes/api/media";
import { withRequest } from "@/lib/next-route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withRequest(getMedia);
