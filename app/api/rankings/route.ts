import { DELETE as deleteRanking, GET as getRankings, PUT as putRanking } from "@/routes/api/rankings";
import { withDataPlane } from "@/lib/next-route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withDataPlane(getRankings);
export const PUT = withDataPlane(putRanking);
export const DELETE = withDataPlane(deleteRanking);
