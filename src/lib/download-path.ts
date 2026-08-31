export const PATH_PRESET_IDS = [
  "flat",
  "author",
  "date",
  "datetime",
  "author-date",
  "site-author",
  "custom",
] as const;

export type PathPreset = (typeof PATH_PRESET_IDS)[number];

export const PATH_PRESETS: { id: PathPreset; label: string; template: string; hint: string }[] = [
  { id: "flat", label: "扁平", template: "{id}_p{page}_{title}.{ext}", hint: "全部放在同一层" },
  { id: "author", label: "作者", template: "{author}/{id}_p{page}_{title}.{ext}", hint: "按画师分文件夹" },
  { id: "date", label: "日期", template: "{date}/{id}_p{page}_{title}.{ext}", hint: "按保存日期" },
  {
    id: "datetime",
    label: "日期+时间",
    template: "{date}/{time}_{id}_p{page}_{title}.{ext}",
    hint: "日期文件夹，文件名带时间",
  },
  {
    id: "author-date",
    label: "作者+日期",
    template: "{author}/{year}-{month}/{id}_p{page}_{title}.{ext}",
    hint: "画师下面再按月",
  },
  {
    id: "site-author",
    label: "站点+作者",
    template: "{source}/{author}/{id}_p{page}_{title}.{ext}",
    hint: "先分站点再分画师",
  },
  { id: "custom", label: "自定义", template: "{author}/{id}_p{page}_{title}.{ext}", hint: "自己写规则" },
];

export const DEFAULT_PATH_PRESET: PathPreset = "author";
export const DEFAULT_PATH_TEMPLATE = PATH_PRESETS.find((p) => p.id === "author")!.template;

export const PATH_TOKEN_HELP = [
  "{author}",
  "{authorId}",
  "{title}",
  "{id}",
  "{source}",
  "{page}",
  "{page1}",
  "{ext}",
  "{date}",
  "{time}",
  "{year}",
  "{month}",
  "{day}",
  "{hour}",
  "{minute}",
  "{second}",
  "{tags}",
] as const;

export type PathContext = {
  author: string;
  authorId: string;
  title: string;
  id: string;
  source: string;
  page: number;
  ext: string;
  tags: string[];
  at: Date;
};

export function parsePathPreset(value: unknown): PathPreset {
  return PATH_PRESET_IDS.includes(value as PathPreset) ? (value as PathPreset) : DEFAULT_PATH_PRESET;
}

export function templateForPreset(id: PathPreset, current?: string): string {
  if (id === "custom") return current?.trim() || DEFAULT_PATH_TEMPLATE;
  return PATH_PRESETS.find((p) => p.id === id)?.template ?? DEFAULT_PATH_TEMPLATE;
}

export function sanitizePathSegment(name: string): string {
  const cleaned = name
    .replace(/[\\/:*?"<>|\n\r]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^[_]+|[_]+$/g, "")
    .replace(/^\.+/, "")
    .replace(/\.+$/, "")
    .trim()
    .slice(0, 80);
  return cleaned || "untitled";
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

export function pathTokens(ctx: PathContext): Record<string, string> {
  const d = Number.isNaN(ctx.at.getTime()) ? new Date() : ctx.at;
  const ext = sanitizePathSegment(ctx.ext.replace(/^\./, ""));
  return {
    author: sanitizePathSegment(ctx.author),
    authorId: sanitizePathSegment(ctx.authorId || "unknown"),
    title: sanitizePathSegment(ctx.title),
    id: sanitizePathSegment(ctx.id),
    source: sanitizePathSegment(ctx.source),
    page: String(Math.max(0, ctx.page)),
    page1: String(Math.max(0, ctx.page) + 1),
    ext,
    tags: sanitizePathSegment(ctx.tags.slice(0, 4).join("_") || "tags"),
    year: String(d.getFullYear()),
    month: pad2(d.getMonth() + 1),
    day: pad2(d.getDate()),
    hour: pad2(d.getHours()),
    minute: pad2(d.getMinutes()),
    second: pad2(d.getSeconds()),
    date: `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`,
    time: `${pad2(d.getHours())}${pad2(d.getMinutes())}${pad2(d.getSeconds())}`,
  };
}

export function formatDownloadPath(template: string, ctx: PathContext): string {
  const tokens = pathTokens(ctx);
  const filled = (template.trim() || DEFAULT_PATH_TEMPLATE).replace(/\{([a-z0-9]+)\}/gi, (_, key: string) => {
    return tokens[key] ?? "";
  });
  const parts = filled
    .split(/[/\\]+/)
    .filter((part) => part && part !== ".." && part !== ".")
    .map((part) => sanitizePathSegment(part))
    .filter((part) => part && part !== ".." && part !== ".");
  if (parts.length === 0) return `${tokens.id}_p${tokens.page}.${tokens.ext}`;
  const last = parts[parts.length - 1];
  if (last && !last.includes(".") && tokens.ext) {
    parts[parts.length - 1] = `${last}.${tokens.ext}`;
  }
  return parts.join("/");
}

export function flattenDownloadName(relativePath: string): string {
  return relativePath.replaceAll("/", "_");
}

export const SAMPLE_PATH_CONTEXT: PathContext = {
  author: "こいし",
  authorId: "22",
  title: "无题",
  id: "12345",
  source: "pixiv",
  page: 0,
  ext: "jpg",
  tags: ["original"],
  at: new Date("2026-08-31T16:05:00"),
};
