import { POST as postSource } from "@/routes/api/source";
import { withDataPlane } from "@/lib/next-route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = withDataPlane(postSource, { guest: true });
