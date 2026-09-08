import { fetchSchema } from "@/lib/source";
import type { FetchInput } from "@/lib/types";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const raw = await request.json();
    const data = fetchSchema.parse(raw) as FetchInput;
    const { dispatchFetch } = await import("@/lib/upstream.server");
    const body = await dispatchFetch(data);
    return Response.json(body, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    const message = err instanceof Error ? err.message : "请求失败";
    return Response.json({ error: message }, { status: 400, headers: { "cache-control": "no-store" } });
  }
}
