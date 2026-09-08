import { GET as getProxy, POST as postProxy } from "@/routes/api/proxy";
import { withRequest } from "@/lib/next-route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withRequest(getProxy);
export const POST = withRequest(postProxy);
