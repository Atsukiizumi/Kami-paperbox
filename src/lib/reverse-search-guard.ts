/**
 * 搜图限流和验证页识别。
 *
 * 作用：控制各引擎最短间隔，并判断返回是不是 Cloudflare / 验证码。
 * 用法：searchGapMs() 给服务端排队；isBotChallenge() 在拿到 HTML 后调用。
 * 为什么：SauceNAO / ascii2d 对短时间多次上传很敏感。纸匣不能解验证码，
 *        只能少打、打小图、有 key 走官方 API。
 */
import type { SearchEngine } from "./reverse-search";

export const SEARCH_GAP_MS: Record<SearchEngine, number> = {
  saucenao: 8_000,
  ascii2d: 15_000,
  iqdb: 6_000,
  tineye: 12_000,
};

export function searchGapMs(engine: SearchEngine, hasApiKey = false): number {
  if (engine === "saucenao" && hasApiKey) return 2_500;
  return SEARCH_GAP_MS[engine];
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
  return /限流|验证|间隔|次数用完|rate.?limit|captcha/i.test(message);
}

export function challengeMessage(engineLabel: string): string {
  return `${engineLabel} 触发了验证或限流。等一会儿，或改用 IQDB。SauceNAO 填 API key 会宽松很多。`;
}
