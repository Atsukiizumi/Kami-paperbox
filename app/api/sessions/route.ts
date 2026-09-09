import { POST as postSessions } from "@/routes/api/sessions";
import { withDataPlane } from "@/lib/next-route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = withDataPlane(postSessions);
