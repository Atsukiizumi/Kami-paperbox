import { GET as getLogin, POST as postLogin } from "@/routes/api/login-browser";
import { withRequest } from "@/lib/next-route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withRequest(getLogin);
export const POST = withRequest(postLogin);
