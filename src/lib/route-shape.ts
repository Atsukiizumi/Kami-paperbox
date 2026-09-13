/**
 * 路径形状谓词（纯函数，react-refresh 洁癖从 back-to-browse.tsx 挪出）。
 *
 * 作用：判定当前 pathname 是作品/详情/主导航页。
 * 用法：app-shell 导航高亮、PageFrame 详情判定。
 */
export function isWorkPath(pathname: string) {
  return pathname.startsWith("/work/");
}

export function isDetailPath(pathname: string) {
  return (
    pathname.startsWith("/work/") ||
    pathname.startsWith("/user/") ||
    pathname.startsWith("/creator/") ||
    pathname.startsWith("/pool/")
  );
}

export function isMainNavPath(pathname: string) {
  return (
    pathname === "/queue" ||
    pathname === "/vault" ||
    pathname === "/settings" ||
    pathname === "/search" ||
    pathname === "/history" ||
    pathname === "/rankings" ||
    pathname.startsWith("/queue/") ||
    pathname.startsWith("/vault/") ||
    pathname.startsWith("/settings/") ||
    pathname.startsWith("/search/") ||
    pathname.startsWith("/history/") ||
    pathname.startsWith("/rankings/")
  );
}
