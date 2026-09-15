/**
 * 路径形状谓词（纯函数，react-refresh 洁癖从 back-to-browse.tsx 挪出）。
 *
 * 作用：判定当前 pathname 是案头/浏览/作品/详情/主导航页。
 * 用法：壳导航高亮用 `navItemActive`；app-shell 导航高亮、PageFrame 详情判定。
 * 为什么：路径判定与 UI 解耦，便于单测且避免 react-refresh 把纯函数绑进组件模块。
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

export function isDeskPath(pathname: string) {
  return pathname === "/";
}

export function isBrowsePath(pathname: string) {
  return pathname === "/browse";
}

export function navItemActive(pathname: string, to: string) {
  if (to === "/") return pathname === "/";
  if (to === "/browse") {
    return (
      pathname === "/browse" ||
      pathname.startsWith("/work") ||
      pathname.startsWith("/user") ||
      pathname.startsWith("/creator")
    );
  }
  return pathname === to || pathname.startsWith(`${to}/`);
}
