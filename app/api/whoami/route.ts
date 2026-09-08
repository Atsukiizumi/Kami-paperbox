import { POST as postWhoami } from "@/routes/api/whoami";
import { withRequest } from "@/lib/next-route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = withRequest(postWhoami);
