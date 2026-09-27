import { GET as trashGet, POST as trashPost } from "@/routes/api/vault-trash";
import { withDataPlane } from "@/lib/next-route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withDataPlane(trashGet);
export const POST = withDataPlane(trashPost);
