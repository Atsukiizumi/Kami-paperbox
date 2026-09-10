import { GET as getProxy, POST as postProxy } from "@/routes/api/proxy";
import { withDataPlane } from "@/lib/next-route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withDataPlane(getProxy);
export const POST = withDataPlane(postProxy);
