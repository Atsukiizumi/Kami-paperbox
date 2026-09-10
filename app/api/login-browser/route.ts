import { GET as getLogin, POST as postLogin } from "@/routes/api/login-browser";
import { withDataPlane } from "@/lib/next-route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withDataPlane(getLogin);
export const POST = withDataPlane(postLogin);
