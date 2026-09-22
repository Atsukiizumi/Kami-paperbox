/**
 * 版本读数（D1，09-22-batch3-download-deploy）。
 *
 * 作用：报当前构建版本（KAMI_VERSION，next.config 构建期注入），并探测
 *      GitHub 最新 tag 提示可升级——升级不再靠记忆。
 * 用法：GET /api/version（公开只读，版本号本身随公开镜像 tag 可见）；
 *      app/api/version/route.ts 壳不做 data-plane 包装；测试直接调 probeVersion。
 * 为什么探测 GitHub tags 而非 GHCR digest：digest 要两跳进 config blob，
 *      tags 一跳出结果且语义直白；仓库不可匿名访问时 latest 缺席，静默降级
 *      只报 current（探测失败不算错，版本卡照常显示）。
 */
export const VERSION_PROBE_TTL_MS = 24 * 60 * 60 * 1000;

const REPO_TAGS_URL = "https://api.github.com/repos/Atsukiizumi/Kami-paperbox/tags?per_page=1";

type VersionProbe = { latest?: string; checkedAt: number };

let cache: VersionProbe | null = null;

export function resetVersionProbeCache(): void {
  cache = null;
}

async function probeLatestTag(fetchImpl: typeof fetch): Promise<string | undefined> {
  try {
    const res = await fetchImpl(REPO_TAGS_URL, {
      headers: { accept: "application/vnd.github+json", "user-agent": "kami-paperbox-version" },
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) return undefined;
    const tags = (await res.json()) as { name?: string }[];
    const name = tags[0]?.name;
    return typeof name === "string" && name ? name : undefined;
  } catch {
    return undefined;
  }
}

/** 组版本载荷（探测带 24h 缓存）；fetchImpl 供单测打桩。 */
export async function probeVersion(fetchImpl: typeof fetch = fetch) {
  const current = process.env.KAMI_VERSION || "dev";
  if (!cache || Date.now() - cache.checkedAt > VERSION_PROBE_TTL_MS) {
    cache = { latest: await probeLatestTag(fetchImpl), checkedAt: Date.now() };
  }
  const latest = cache.latest;
  // dev/无版本形态不提示升级（没有可比对象）；latest 缺席（私有仓/断网）同样不提示
  const hasUpdate = Boolean(latest && current !== "dev" && latest !== current);
  return { current, latest, hasUpdate, checkedAt: cache.checkedAt };
}

export async function GET() {
  return Response.json({ ok: true, ...(await probeVersion()) }, {
    headers: { "cache-control": "no-store" },
  });
}
