import { GUEST_SOURCE_LIMIT } from "@/lib/guest-rate";
import { withDataPlane } from "@/lib/next-route";
import { POST as postSource } from "@/routes/api/source";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = withDataPlane(postSource, { guest: true, guestRate: { bucket: "source", limit: GUEST_SOURCE_LIMIT } });
