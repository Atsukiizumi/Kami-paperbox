export type SocialState = {
  liked: boolean;
  bookmarked: boolean;
  bookmarkId?: string;
  followed: boolean;
};

function asRecord(v: unknown): Record<string, unknown> {
  return v !== null && typeof v === "object" ? (v as Record<string, unknown>) : {};
}

function asString(v: unknown): string {
  if (typeof v === "string") return v;
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return "";
}

export function socialFromPixivIllust(body: Record<string, unknown>): SocialState {
  const bookmark = asRecord(body.bookmarkData);
  const bookmarkId = asString(bookmark.id);
  const like = body.likeData;
  const liked =
    like === true ||
    (like !== null && typeof like === "object" && (like as { isLiked?: unknown }).isLiked === true);
  return {
    liked,
    bookmarked: Boolean(bookmarkId),
    bookmarkId: bookmarkId || undefined,
    followed: body.isFollowed === true,
  };
}

export function bookmarkTagsOf(tags: readonly string[]): string[] {
  return tags
    .map((t) => t.trim())
    .filter((t) => t && t.length <= 30 && !/^r-?18/i.test(t))
    .slice(0, 10);
}
