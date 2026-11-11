import { resolveIdentities } from "@/lib/site-identity.server";
import { readMirroredSiteSecrets } from "@/lib/sync/session-cookies.server";

function json(data: unknown, status = 200) {
  return Response.json(data, {
    status,
    headers: { "cache-control": "no-store" },
  });
}

export async function POST(request: Request) {
        const secrets = readMirroredSiteSecrets(request.headers.get("cookie"));
        const profiles = await resolveIdentities({ pixiv: secrets.pixiv, fanbox: secrets.fanbox });
        return json({ ok: true, ...profiles });
}
