import { POST as postExport } from "@/routes/api/vault-export";
import { withDataPlane } from "@/lib/next-route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = withDataPlane(postExport);
