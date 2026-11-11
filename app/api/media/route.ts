import { GUEST_MEDIA_LIMIT } from "@/lib/guest-rate";
import { withDataPlane } from "@/lib/next-route";
import { GET as getMedia } from "@/routes/api/media";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withDataPlane(getMedia, { guest: true, guestRate: { bucket: "media", limit: GUEST_MEDIA_LIMIT } });
