import type { BooruSite, Source } from "./types";

export type ParsedQuery =
  | { kind: "pixiv-illust"; id: string }
  | { kind: "pixiv-user"; id: string }
  | { kind: "pixiv-tag"; word: string }
  | { kind: "fanbox-post"; id: string; creator?: string }
  | { kind: "fanbox-creator"; id: string }
  | { kind: "fanbox-tag"; word: string }
  | { kind: "booru-post"; site: BooruSite; id: string }
  | { kind: "booru-tag"; site: BooruSite; word: string }
  | { kind: "query"; word: string };

function tagsFromSearch(search: string): string {
  try {
    return (new URLSearchParams(search).get("tags") ?? "").replace(/\+/g, " ").trim();
  } catch {
    return "";
  }
}

function decodePath(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

export function parseUserInput(raw: string, tab: Source): ParsedQuery {
  const text = raw.trim();
  if (!text) return { kind: "query", word: "" };

  const yande = text.match(/yande\.re\/post\/show\/(\d+)/i);
  if (yande?.[1]) return { kind: "booru-post", site: "yande", id: yande[1] };

  const yandeList = text.match(/yande\.re\/post\/?(?:\?([^#]*))?$/i);
  if (yandeList) {
    const word = tagsFromSearch(yandeList[1] || "");
    if (word) return { kind: "booru-tag", site: "yande", word };
  }

  const kona = text.match(/konachan\.(?:com|net)\/post\/show\/(\d+)/i);
  if (kona?.[1]) return { kind: "booru-post", site: "konachan", id: kona[1] };

  const konaList = text.match(/konachan\.(?:com|net)\/post\/?(?:\?([^#]*))?$/i);
  if (konaList) {
    const word = tagsFromSearch(konaList[1] || "");
    if (word) return { kind: "booru-tag", site: "konachan", word };
  }

  const danbooru = text.match(/donmai\.us\/posts\/(\d+)/i);
  if (danbooru?.[1]) return { kind: "booru-post", site: "danbooru", id: danbooru[1] };

  const danbooruList = text.match(/donmai\.us\/posts\/?(?:\?([^#]*))?$/i);
  if (danbooruList) {
    const word = tagsFromSearch(danbooruList[1] || "");
    if (word) return { kind: "booru-tag", site: "danbooru", word };
  }

  const art = text.match(/pixiv\.net\/(?:\w+\/)?artworks\/(\d+)/i);
  if (art?.[1]) return { kind: "pixiv-illust", id: art[1] };

  const illustQ = text.match(/[?&]illust_id=(\d+)/i);
  if (illustQ?.[1]) return { kind: "pixiv-illust", id: illustQ[1] };

  const user = text.match(/pixiv\.net\/(?:\w+\/)?users\/(\d+)/i);
  if (user?.[1]) return { kind: "pixiv-user", id: user[1] };

  const tag = text.match(/pixiv\.net\/(?:\w+\/)?tags\/([^/?#]+)/i);
  if (tag?.[1]) return { kind: "pixiv-tag", word: decodePath(tag[1]) };

  const fanboxHost = text.match(
    /(?:https?:\/\/)?([a-z0-9_-]+)\.fanbox\.cc(?:\/posts\/(\d+))?/i,
  );
  if (fanboxHost?.[1] && fanboxHost[1].toLowerCase() !== "www") {
    if (fanboxHost[2]) {
      return { kind: "fanbox-post", id: fanboxHost[2], creator: fanboxHost[1] };
    }
    return { kind: "fanbox-creator", id: fanboxHost[1] };
  }

  const fanboxAt = text.match(/fanbox\.cc\/@([a-z0-9_-]+)(?:\/posts\/(\d+))?/i);
  if (fanboxAt?.[1]) {
    if (fanboxAt[2]) {
      return { kind: "fanbox-post", id: fanboxAt[2], creator: fanboxAt[1] };
    }
    return { kind: "fanbox-creator", id: fanboxAt[1] };
  }

  if (/^\d+$/.test(text)) {
    if (tab === "fanbox") return { kind: "fanbox-post", id: text };
    if (tab === "yande" || tab === "konachan" || tab === "danbooru") {
      return { kind: "booru-post", site: tab, id: text };
    }
    return { kind: "pixiv-illust", id: text };
  }

  if (tab === "fanbox" && /^[a-z0-9_-]+$/i.test(text) && text.length <= 64) {
    return { kind: "fanbox-creator", id: text };
  }

  if (tab === "fanbox") {
    return { kind: "fanbox-tag", word: text };
  }

  if (tab === "yande" || tab === "konachan" || tab === "danbooru") {
    return { kind: "booru-tag", site: tab, word: text };
  }

  return { kind: "query", word: text };
}
