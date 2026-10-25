/**
 * 动效 E2E 夹具（动效批 2026-10-25 · Task 2 起）。
 *
 * 作用：在隔离 e2e server（scripts/e2e-server.mjs 的临时 KAMI_ROOT）上预置
 *   「已引导 + 指定动效开关」的本地偏好，拦截 /api/source 与 /api/media，
 *   返回固定的非敏感图卡（首页 200 张、次页 40 张），不访问真实图站/账号/.data。
 * 用法：await seedMotionStudy(page, { motionEnabled?: boolean })，随后 page.goto("/")。
 *   Task 3–5 在同一夹具上扩用例（预览、入队、灯箱、详情返回）。
 * 为什么：动效连续性断言不能依赖真实上游的网络抖动；图卡几何（长宽比序列）
 *   固定下来，「重排前后几何一致」才有可对照的基线。
 */
import type { Page } from "@playwright/test";

/** 10 种长宽比循环——行拼版会给出可预测的混合行，足以覆盖重排路径。 */
const ASPECTS = [0.75, 1, 1.33, 1.78, 0.7, 0.9, 1.2, 2.2, 0.55, 1.5];
const FIRST_PAGE = 200;
const TAIL_PAGES = 40;

type StudyCard = {
  source: "yande";
  id: string;
  title: string;
  author: string;
  authorId: string;
  thumb: string;
  pageCount: number;
  tags: string[];
  width: number;
  height: number;
};

function makeCards(count: number, offset: number): StudyCard[] {
  return Array.from({ length: count }, (_, i) => {
    const n = offset + i;
    const aspect = ASPECTS[n % ASPECTS.length]!;
    return {
      source: "yande",
      id: String(1_000_000 + n),
      title: `动效样张 ${n + 1}`,
      author: `画师${(n % 7) + 1}`,
      authorId: String(200 + (n % 7)),
      thumb: `https://motion-study.invalid/t/${n % 40}.jpg`,
      pageCount: 1,
      tags: ["kami_motion_study"],
      width: Math.round(1000 * aspect),
      height: 1000,
    };
  });
}

/** 由卡片派生的最小合法 WorkDetail——浏览页对每页首卡有详情预取，别让它拿到 undefined。 */
function studyDetail(card: StudyCard) {
  const page = {
    thumb: card.thumb,
    regular: card.thumb,
    original: card.thumb,
    width: card.width,
    height: card.height,
    kind: "image" as const,
  };
  return { ...card, rating: "s", description: "", pages: [page] };
}

/** 4:3 的极小 SVG——媒体请求统一以它应答，解码成本可忽略。
 * width/height 必须显式给出：只有 viewBox 时灯箱（object-contain、仅 max 约束）
 * 会把它当无内在尺寸的纵横比图，塌缩成 0×0。 */
const SVG_BODY =
  '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300" viewBox="0 0 400 300"><rect width="400" height="300" fill="#2a2723"/><circle cx="200" cy="150" r="80" fill="#d8cfc0"/></svg>';

/** 默认形态下数据面要会话：本进程首个用例注册唯一账号并缓存会话 cookie，
 * 后续用例直接带 cookie——不再每个用例都走登录/注册（隔离库上稳定且省时）。 */
const STUDY_PASSWORD = "kami-e2e-pass-123";
let sessionCookies: { name: string; value: string; domain: string; path: string }[] | null = null;

async function ensureSession(page: Page) {
  if (sessionCookies?.length) {
    await page.context().addCookies(sessionCookies);
    return;
  }
  await page.goto("/settings#accounts", { waitUntil: "domcontentloaded" });
  const email = page.locator("#app-account-email");
  try {
    await email.waitFor({ state: "visible", timeout: 20_000 });
  } catch {
    return; // 账号关闭形态——数据面走 LAN 令牌，不在本夹具范围
  }
  await page.waitForFunction(() => {
    const input = document.querySelector("#app-account-email");
    return input instanceof HTMLInputElement && !input.disabled;
  }, undefined, { timeout: 60_000, polling: 500 });
  if (await page.getByText("已登录").count()) {
    sessionCookies = (await page.context().storageState()).cookies.map(({ name, value, domain, path }) => ({ name, value, domain, path }));
    return;
  }
  const emailAddr = `kami-e2e-motion-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
  await email.fill(emailAddr);
  await page.locator("#app-account-password").fill(STUDY_PASSWORD);
  await page.getByRole("button", { name: "注册", exact: true }).click();
  await page.getByText("已登录").first().waitFor({ timeout: 30_000 });
  sessionCookies = (await page.context().storageState()).cookies.map(({ name, value, domain, path }) => ({ name, value, domain, path }));
}

export async function seedMotionStudy(page: Page, opts?: { motionEnabled?: boolean }) {
  const motionEnabled = opts?.motionEnabled ?? true;
  await page.addInitScript(
    ({ motionEnabled }) => {
      localStorage.setItem(
        "kami-settings",
        JSON.stringify({
          state: { onboarded: true, tab: "yande", motionEnabled },
          version: 21,
        }),
      );
    },
    { motionEnabled },
  );

  await page.route("**/api/source", async (route) => {
    const payload = route.request().postDataJSON() as { op?: string; page?: number };
    if (payload?.op === "booruList") {
      const pageNo = payload.page ?? 1;
      // 首页 200 张、随后两页各 40 张：末页（第 5 列表页）先出 40 张、再原地长出
      // 最后 10 张——「追加不重播」的场景就发生在这个视图里。
      const json =
        pageNo === 1
          ? { op: "booruList", site: "yande", items: makeCards(FIRST_PAGE, 0), nextPage: 2 }
          : pageNo === 2
            ? { op: "booruList", site: "yande", items: makeCards(TAIL_PAGES, FIRST_PAGE), nextPage: 3 }
            : pageNo === 3
              ? { op: "booruList", site: "yande", items: makeCards(TAIL_PAGES, FIRST_PAGE + TAIL_PAGES), nextPage: null }
              : { op: "booruList", site: "yande", items: [], nextPage: null };
      await route.fulfill({ json });
      return;
    }
    if (payload?.op === "booruPost") {
      const id = Number.parseInt(String((payload as { id?: string }).id ?? ""), 10);
      const n = Number.isFinite(id) ? id - 1_000_000 : 0;
      await route.fulfill({ json: { op: "booruPost", work: studyDetail(makeCards(1, Math.max(0, n))[0]!) } });
      return;
    }
    // 其余 op 不在本夹具范围（Task 5 扩灯箱时再补）
    await route.fulfill({ json: { op: payload?.op ?? "unknown", items: [], nextPage: null } });
  });

  await page.route("**/api/media*", async (route) => {
    await route.fulfill({ contentType: "image/svg+xml", body: SVG_BODY });
  });

  await ensureSession(page);
}
