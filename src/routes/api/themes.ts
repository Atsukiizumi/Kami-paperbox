/**
 * 主题包 HTTP（everything can design · P2）。
 *
 * 作用：GET 列出 themes/ 的包（含已清洗 css 与降级原因）；POST 三个操作——
 *      openDir（打开主题文件夹）/ rescan（清缓存重扫）/ export（把客户端组装的
 *      manifest 复验后落盘成新包）。
 * 用法：app/api/themes/route.ts 壳挂 withDataPlane（GET guest:read、POST 需会话）。
 * 为什么：对 themes/ 只读（导出只写自己新建的目录），校验全在 theme-pack 层。
 */
import { exportThemePack, openThemesDir, scanThemePacks } from "@/lib/theme-pack.server";

export async function GET(request: Request) {
  const force = new URL(request.url).searchParams.get("rescan") === "1";
  const { packs, overLimit, broken } = scanThemePacks(force);
  // 不回 themes/ 的绝对路径（guest 可读，路径含本机用户名；UI 也不消费）
  return Response.json({ themes: packs, overLimit, broken });
}

export async function POST(request: Request) {
  let body: { op?: string; manifest?: unknown } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    /* 空体走 default */
  }
  switch (body.op) {
    case "openDir": {
      return Response.json(openThemesDir());
    }
    case "rescan": {
      const { packs, overLimit, broken } = scanThemePacks(true);
      return Response.json({ themes: packs, overLimit, broken });
    }
    case "export": {
      const result = exportThemePack(body.manifest);
      if (!result.ok) return Response.json({ error: result.error }, { status: 400 });
      return Response.json(result);
    }
    default:
      return Response.json({ error: "未知操作" }, { status: 400 });
  }
}
