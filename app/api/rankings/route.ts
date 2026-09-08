import { DELETE as deleteRanking, GET as getRankings, PUT as putRanking } from "@/routes/api/rankings";
import { withRequest } from "@/lib/next-route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withRequest(getRankings);
export const PUT = withRequest(putRanking);
export const DELETE = withRequest(deleteRanking);
