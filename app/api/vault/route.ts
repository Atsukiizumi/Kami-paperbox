import { DELETE as deleteVault, GET as getVault, PATCH as patchVault, PUT as putVault } from "@/routes/api/vault";
import { withDataPlane } from "@/lib/next-route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withDataPlane(getVault);
export const PUT = withDataPlane(putVault);
export const PATCH = withDataPlane(patchVault);
export const DELETE = withDataPlane(deleteVault);
