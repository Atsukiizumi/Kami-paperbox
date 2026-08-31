export type UgoiraFrame = { file: string; delay: number };

export type UgoiraMeta = {
  src: string;
  originalSrc: string;
  mimeType: string;
  frames: UgoiraFrame[];
};

function asRecord(v: unknown): Record<string, unknown> {
  return v !== null && typeof v === "object" ? (v as Record<string, unknown>) : {};
}

function asString(v: unknown, fallback = ""): string {
  return typeof v === "string" ? v : fallback;
}

function asNumber(v: unknown, fallback = 0): number {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v !== "" && Number.isFinite(Number(v))) return Number(v);
  return fallback;
}

export function mapUgoiraMeta(raw: unknown): UgoiraMeta | null {
  const root = asRecord(raw);
  const body = asRecord(root.body ?? root);
  const src = asString(body.src);
  const originalSrc = asString(body.originalSrc || body.src);
  const list = Array.isArray(body.frames) ? body.frames : [];
  const frames: UgoiraFrame[] = [];
  for (const item of list) {
    const rec = asRecord(item);
    const file = asString(rec.file);
    if (!file) continue;
    frames.push({ file, delay: Math.max(10, asNumber(rec.delay, 100)) });
  }
  if (!src || frames.length === 0) return null;
  return {
    src,
    originalSrc: originalSrc || src,
    mimeType: asString(body.mime_type || body.mimeType, "image/jpeg"),
    frames,
  };
}

export function extFromNameOrType(name?: string, type?: string): string {
  const fromName = name?.split(".").pop()?.toLowerCase() ?? "";
  if (fromName === "jpeg") return "jpg";
  if (fromName && /^[a-z0-9]{2,5}$/.test(fromName)) return fromName;
  const t = (type || "").toLowerCase();
  if (t.includes("gif")) return "gif";
  if (t.includes("png")) return "png";
  if (t.includes("webp")) return "webp";
  if (t.includes("zip")) return "zip";
  if (t.includes("jpeg") || t.includes("jpg")) return "jpg";
  return "jpg";
}
