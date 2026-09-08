import { toNextJsHandler } from "better-auth/next-js";
import { auth } from "@/lib/auth/server";
import { withRequest } from "@/lib/next-route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const handler = toNextJsHandler(auth);

export const GET = withRequest(handler.GET);
export const POST = withRequest(handler.POST);
export const PUT = withRequest(handler.PUT);
export const PATCH = withRequest(handler.PATCH);
export const DELETE = withRequest(handler.DELETE);
