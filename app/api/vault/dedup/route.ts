import { GET as getDedup, POST as postDedup } from "@/routes/api/vault-dedup";
import { withDataPlane } from "@/lib/next-route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withDataPlane(getDedup);
export const POST = withDataPlane(postDedup);
