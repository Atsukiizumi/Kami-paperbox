import { POST as postReverseSearch } from "@/routes/api/reverse-search";
import { withRequest } from "@/lib/next-route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = withRequest(postReverseSearch);
