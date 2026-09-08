import { DELETE as deleteVault, GET as getVault, PATCH as patchVault, PUT as putVault } from "@/routes/api/vault";
import { withRequest } from "@/lib/next-route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withRequest(getVault);
export const PUT = withRequest(putVault);
export const PATCH = withRequest(patchVault);
export const DELETE = withRequest(deleteVault);
