export type SiteProfile = {
  id: string;
  name: string;
  avatar?: string;
};

export function cleanAvatarUrl(raw: unknown): string | undefined {
  const v = str(raw)
    .replace(/\\u002[fF]/g, "/")
    .replace(/\\\//g, "/")
    .trim();
  if (!v) return undefined;
  if (!/^https:\/\//i.test(v)) return undefined;
  return v;
}

export function parsePixivMe(json: unknown, html = ""): SiteProfile | null {
  const rec = asRecord(json);
  const body = asRecord(rec.body);
  const status = asRecord(body.user_status ?? body.userStatus ?? body.user ?? body);
  const id = str(status.user_id ?? status.userId ?? status.id ?? rec.user_id);
  const name = str(status.user_name ?? status.userName ?? status.name ?? status.pixivId);
  const img = status.profile_img ?? status.profileImg;
  const avatar = cleanAvatarUrl(
    typeof img === "string"
      ? img
      : asRecord(img).main ?? asRecord(img).medium ?? status.imageBig ?? status.image ?? status.iconUrl,
  );
  if (id && name) return { id, name, avatar };

  const htmlId =
    html.match(/userData"\s*[:=]\s*\{[^}]*?"id"\s*:\s*"(\d+)"/)?.[1] ||
    html.match(/pixiv\.user\.id\s*=\s*"(\d+)"/)?.[1] ||
    html.match(/"user_id"\s*:\s*"(\d+)"/)?.[1];
  const htmlName =
    html.match(/userData"\s*[:=]\s*\{[^}]*?"name"\s*:\s*"([^"]+)"/)?.[1] ||
    html.match(/pixiv\.user\.name\s*=\s*"([^"]+)"/)?.[1];
  const htmlAvatar = cleanAvatarUrl(
    html.match(/"profileImg"\s*:\s*"(https:[^"]+)"/)?.[1] ||
      html.match(/"imageBig"\s*:\s*"(https:[^"]+)"/)?.[1] ||
      html.match(/"image"\s*:\s*"(https:\/\/[is]\.pximg\.net[^"]+)"/)?.[1],
  );
  if (htmlId && htmlName) return { id: htmlId, name: decodeJsonString(htmlName), avatar: htmlAvatar };
  return null;
}

export function parseFanboxMe(json: unknown, html = ""): SiteProfile | null {
  const rec = asRecord(json);
  const body = asRecord(rec.body);
  const user = asRecord(body.user ?? body);
  const id = str(user.userId ?? user.user_id ?? user.id);
  const name = str(user.name ?? user.creatorId ?? user.nickName);
  const avatar = cleanAvatarUrl(user.iconUrl ?? user.avatarUrl ?? user.icon ?? asRecord(user.iconUrl).url);
  if (id && name) return { id, name, avatar };

  const htmlId = html.match(/"userId"\s*:\s*"(\d+)"/)?.[1];
  const htmlName = html.match(/"name"\s*:\s*"([^"]+)"/)?.[1];
  const htmlAvatar = cleanAvatarUrl(
    html.match(/"iconUrl"\s*:\s*"(https:[^"]+)"/)?.[1] || html.match(/"avatarUrl"\s*:\s*"(https:[^"]+)"/)?.[1],
  );
  if (htmlId && htmlName) return { id: htmlId, name: decodeJsonString(htmlName), avatar: htmlAvatar };
  return null;
}

function asRecord(v: unknown): Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

function str(v: unknown): string {
  if (typeof v === "string") return v.trim();
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return "";
}

function decodeJsonString(value: string): string {
  try {
    return JSON.parse(`"${value.replace(/"/g, '\\"')}"`) as string;
  } catch {
    return value;
  }
}
