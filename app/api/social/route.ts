import { POST as postSocial } from "@/routes/api/social";
import { withDataPlane } from "@/lib/next-route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = withDataPlane(postSocial);
