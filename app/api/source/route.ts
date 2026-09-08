import { POST as postSource } from "@/routes/api/source";
import { withRequest } from "@/lib/next-route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = withRequest(postSource);
