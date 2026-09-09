import { toNextJsHandler } from "better-auth/next-js";
import { auth } from "@/lib/auth/server";
import { withRequest } from "@/lib/next-route";
import { scheduleSnapshotDump } from "@/lib/db-snapshot.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const handler = toNextJsHandler(auth);

// 注册 / 登录 / 登出都走 POST：办完立刻把账号和会话落进 JSON 快照，
// 强杀进程最多丢这几百毫秒，重启照常登录。
export const GET = withRequest(handler.GET);
export const POST = withRequest(async (request: Request) => {
  const res = await handler.POST(request);
  scheduleSnapshotDump();
  return res;
});
export const PUT = withRequest(handler.PUT);
export const PATCH = withRequest(handler.PATCH);
export const DELETE = withRequest(handler.DELETE);
