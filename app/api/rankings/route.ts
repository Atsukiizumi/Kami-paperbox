import { GUEST_RANKINGS_LIMIT } from "@/lib/guest-rate";
import { withDataPlane } from "@/lib/next-route";
import { DELETE as deleteRanking, GET as getRankings, PUT as putRanking } from "@/routes/api/rankings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withDataPlane(getRankings, {
  guest: "read",
  guestRate: { bucket: "rankings", limit: GUEST_RANKINGS_LIMIT },
});
export const PUT = withDataPlane(putRanking);
export const DELETE = withDataPlane(deleteRanking);
