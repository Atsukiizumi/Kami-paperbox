/**
 * 搜图限流和验证页识别。
 *
 * 作用：控制各引擎最短间隔，并判断返回是不是 Cloudflare / 验证码。
 * 用法：searchGapMs() 给服务端排队；isBotChallenge() 在拿到 HTML 后调用。
 * 为什么：SauceNAO / ascii2d 对短时间多次上传很敏感。纸匣不代解验证码。
 *        SauceNAO 用官方 key；ascii2d 没有接口，被拦住就停；Danbooru 靠账号免验证。
 */
import type { SearchEngine } from "./reverse-search.ts";

export const SEARCH_GAP_MS: Record<SearchEngine, number> = {
  saucenao: 8_000,
  ascii2d: 15_000,
  iqdb: 6_000,
  tracemoe: 3_000,
  danbooru: 6_000,
};

export function searchGapMs(
  engine: SearchEngine,
  hasApiKey = false,
  overrides?: Partial<Record<SearchEngine, number>>,
): number {
  const base = overrides?.[engine] ?? SEARCH_GAP_MS[engine];
  // SauceNAO 官方接口免费档 30 秒约 6 次：key 只把 8 秒压到 5.5 秒，再快必吃 429。
  if (engine === "saucenao" && hasApiKey) return Math.min(base, 5_500);
  return base;
}

export function fallbackSearchEngine(engine: SearchEngine): SearchEngine {
  return engine === "iqdb" ? "saucenao" : "iqdb";
}

export function isBotChallenge(status: number, text: string): boolean {
  if (status === 403 || status === 429 || status === 503) return true;
  return /cloudflare|cf-challenge|just a moment|attention required|hcaptcha|recaptcha|captcha|access denied|rate.?limit|too many requests/i.test(
    text.slice(0, 4000),
  );
}

export function isSearchLimited(message: string): boolean {
  return /限流|验证|间隔|次数用完|风控|rate.?limit|captcha/i.test(message);
}

export function challengeMessage(engineLabel: string): string {
  return `${engineLabel} 被风控了`;
}
