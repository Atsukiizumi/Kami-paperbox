import { POST as postWhoami } from "@/routes/api/whoami";
import { withDataPlane } from "@/lib/next-route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = withDataPlane(postWhoami);
