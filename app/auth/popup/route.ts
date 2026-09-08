import { handleAuthPopupRequest } from "@/lib/auth/popup.server";
import { withRequest } from "@/lib/next-route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withRequest(handleAuthPopupRequest);
