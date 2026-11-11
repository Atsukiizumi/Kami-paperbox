/**
 * 红心 / 关注 / 收藏 HTTP。
 */
import { socialSchema } from "@/lib/source";
import { applyMirroredSecrets } from "@/lib/sync/session-cookies.server";
import type { SocialInput } from "@/lib/types";

export async function POST(request: Request) {
        try {
          const raw = await request.json();
          const data = socialSchema.parse(raw) as SocialInput;
          applyMirroredSecrets(data, request.headers.get("cookie"));
          const { dispatchSocial } = await import("@/lib/social.server");
          const body = await dispatchSocial(data);
          return Response.json(body, { headers: { "cache-control": "no-store" } });
        } catch (err) {
          const message = err instanceof Error ? err.message : "请求失败";
          return Response.json({ error: message }, { status: 400, headers: { "cache-control": "no-store" } });
        }
}
