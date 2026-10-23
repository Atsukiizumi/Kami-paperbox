/**
 * 主题包资产 HTTP（everything can design · P2）。
 *
 * 作用：按声明白名单出包内文件（字体/纸纹/预览图），供 theme.css 的 url() 与
 *      管理页缩略图使用——本地服务端出，离线可用。
 * 用法：app/api/themes/asset/route.ts 壳挂 withDataPlane（guest:read）。
 * 为什么：所有路径校验集中在 readThemeAsset（防穿越/未声明/超限），路由零逻辑。
 */
import { readThemeAsset } from "@/lib/theme-pack.server";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const theme = url.searchParams.get("theme") ?? "";
  const file = url.searchParams.get("file") ?? "";
  const result = readThemeAsset(theme, file);
  if (!result.ok) {
    return Response.json({ error: result.error }, { status: result.status });
  }
  return new Response(
    // fetch 运行时收 BufferSource；TS 的 BodyInit 泛型对 Uint8Array<ArrayBufferLike> 过严，断言过
    result.bytes as BodyInit,
    {
      headers: {
        "content-type": result.mime,
        // 短缓存：换包内容后最多 5 分钟旧图；不做 immutable（包文件可被用户随手改）
        "cache-control": "private, max-age=300",
        // 直接导航到 svg 资产时按文档渲染——CSP 掐掉同源脚本（包是别人分享来的）
        "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; img-src data:",
      },
    },
  );
}
