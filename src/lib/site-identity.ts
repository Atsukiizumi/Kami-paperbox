/**
 * 从 JSON/HTML 抠登录用户的名字和头像。
 *
 * 作用：设置页显示「这是谁」；接口 401 时还能从首页 HTML 兜底。
 * 用法：parsePixivMe / parseFanboxMe。真正发请求在 site-identity.server.ts。
 * 为什么：self/status 和 user.info 有时被拦，页面里的 meta-global-data 往往还有一份。
 */
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
  if (isExplicitlyLoggedOut(body) || isExplicitlyLoggedOut(rec)) return null;
  const status = asRecord(body.user_status ?? body.userStatus ?? body.user ?? body);
  if (isExplicitlyLoggedOut(status)) return null;
  const fromJson = profileFromFields(
    status.user_id ?? status.userId ?? status.id ?? rec.user_id,
    status.user_name ?? status.userName ?? status.name ?? status.pixivId,
    avatarFrom(status),
  );
  if (fromJson) return fromJson;

  const userData = extractJsonObject(html, "userData") ?? extractMetaGlobalUser(html);
  const fromBlob = profileFromFields(
    asRecord(userData).id ?? asRecord(userData).userId,
    asRecord(userData).name ?? asRecord(userData).pixivId,
    asRecord(userData).profileImg ?? asRecord(userData).imageBig ?? asRecord(userData).image,
  );
  if (fromBlob) return fromBlob;

  const htmlId =
    html.match(/pixiv\.user\.id\s*=\s*"(\d+)"/)?.[1] ||
    html.match(/"user_id"\s*:\s*"(\d+)"/)?.[1];
  const htmlName =
    html.match(/pixiv\.user\.name\s*=\s*"([^"]+)"/)?.[1] ||
    html.match(/"user_name"\s*:\s*"([^"]+)"/)?.[1];
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

  const htmlUser = extractJsonObject(html, "user");
  const fromBlob = profileFromFields(
    asRecord(htmlUser).userId ?? asRecord(htmlUser).id,
    asRecord(htmlUser).name,
    asRecord(htmlUser).iconUrl ?? asRecord(htmlUser).avatarUrl,
  );
  if (fromBlob) return fromBlob;

  const htmlId = html.match(/"userId"\s*:\s*"(\d+)"/)?.[1];
  const htmlName = html.match(/"name"\s*:\s*"([^"]+)"/)?.[1];
  const htmlAvatar = cleanAvatarUrl(
    html.match(/"iconUrl"\s*:\s*"(https:[^"]+)"/)?.[1] || html.match(/"avatarUrl"\s*:\s*"(https:[^"]+)"/)?.[1],
  );
  if (htmlId && htmlName) return { id: htmlId, name: decodeJsonString(htmlName), avatar: htmlAvatar };
  return null;
}

function isExplicitlyLoggedOut(rec: Record<string, unknown>): boolean {
  const flag = rec.is_login ?? rec.isLogin ?? rec.is_logged_in ?? rec.isLoggedIn;
  return flag === false || flag === 0 || flag === "false";
}

function avatarFrom(status: Record<string, unknown>): unknown {
  const img = status.profile_img ?? status.profileImg;
  if (typeof img === "string") return img;
  return asRecord(img).main ?? asRecord(img).medium ?? status.imageBig ?? status.image ?? status.iconUrl;
}

function profileFromFields(idRaw: unknown, nameRaw: unknown, avatarRaw: unknown): SiteProfile | null {
  const id = str(idRaw);
  const name = str(nameRaw);
  if (!id || id === "0" || !name) return null;
  return { id, name, avatar: cleanAvatarUrl(avatarRaw) };
}

function extractMetaGlobalUser(html: string): unknown {
  const quoted =
    html.match(/id="meta-global-data"[^>]*content='([^']+)'/)?.[1] ||
    html.match(/id="meta-global-data"[^>]*content="([^"]+)"/)?.[1];
  if (!quoted) return null;
  try {
    const parsed = JSON.parse(decodeHtmlEntities(quoted)) as unknown;
    return asRecord(parsed).userData;
  } catch {
    return null;
  }
}

function extractJsonObject(source: string, key: string): unknown {
  const needle = `"${key}"`;
  let from = 0;
  while (from < source.length) {
    const idx = source.indexOf(needle, from);
    if (idx < 0) return null;
    const colon = source.indexOf(":", idx + needle.length);
    if (colon < 0) return null;
    const start = source.indexOf("{", colon);
    if (start < 0 || start - colon > 8) {
      from = idx + needle.length;
      continue;
    }
    let depth = 0;
    let inString = false;
    let escape = false;
    for (let i = start; i < source.length; i++) {
      const c = source[i];
      if (inString) {
        if (escape) escape = false;
        else if (c === "\\") escape = true;
        else if (c === '"') inString = false;
        continue;
      }
      if (c === '"') inString = true;
      else if (c === "{") depth++;
      else if (c === "}") {
        depth--;
        if (depth === 0) {
          try {
            return JSON.parse(source.slice(start, i + 1)) as unknown;
          } catch {
            from = i + 1;
            break;
          }
        }
      }
    }
    from = idx + needle.length;
  }
  return null;
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/"/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&/g, "&");
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
