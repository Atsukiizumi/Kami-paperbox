import { DELETE as cloudDelete, GET as cloudGet, POST as cloudPost, PUT as cloudPut } from "@/routes/api/vault-cloud-backup";
import { withDataPlane } from "@/lib/next-route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withDataPlane(cloudGet);
export const PUT = withDataPlane(cloudPut);
export const DELETE = withDataPlane(cloudDelete);
export const POST = withDataPlane(cloudPost);
