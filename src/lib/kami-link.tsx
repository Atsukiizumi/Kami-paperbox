/**
 * 站内跳转。Next.js 用 next/link；参数路由仍写成 `/work/$source/$id`。
 */
"use client";

import NextLink from "next/link";
import {
  useParams as useNextParams,
  usePathname,
  useRouter,
} from "next/navigation";
import { forwardRef, useEffect, type ComponentProps, type ReactNode } from "react";

export function fillPath(to: string, params?: Record<string, string>) {
  if (!params) return to;
  return to.replace(/\$([A-Za-z0-9_]+)/g, (_, key: string) => encodeURIComponent(params[key] ?? ""));
}

export const KNOWN_ROUTE_PATHS = [
  "/",
  "/rankings",
  "/history",
  "/search",
  "/queue",
  "/vault",
  "/settings",
  "/work/$source/$id",
  "/user/$id",
  "/creator/$id",
  "/pool/$site/$id",
] as const;

type LinkProps = {
  to?: string;
  href?: string;
  params?: Record<string, string>;
  hash?: string;
  children?: ReactNode;
  className?: string;
  resetScroll?: boolean;
} & Omit<ComponentProps<typeof NextLink>, "href">;

export const Link = forwardRef<HTMLAnchorElement, LinkProps>(function Link(
  { to, href, params, hash, resetScroll, ...rest },
  ref,
) {
  let path = href ?? to ?? "/";
  path = fillPath(path, params);
  if (hash) path = `${path}#${hash}`;
  return <NextLink ref={ref} href={path} scroll={resetScroll === false ? false : undefined} {...rest} />;
});

export function useNavigate() {
  const router = useRouter();
  return (opts: string | { to: string; params?: Record<string, string>; hash?: string }) => {
    let path = typeof opts === "string" ? opts : fillPath(opts.to, opts.params);
    if (typeof opts !== "string" && opts.hash) path = `${path}#${opts.hash}`;
    router.push(path);
  };
}

export function useParams<T extends Record<string, string> = Record<string, string>>(): T {
  const raw = useNextParams();
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw)) {
    out[key] = Array.isArray(value) ? (value[0] ?? "") : (value ?? "");
  }
  return out as T;
}

export function Navigate({ to }: { to: string }) {
  const router = useRouter();
  useEffect(() => {
    router.replace(to);
  }, [router, to]);
  return null;
}

export { usePathname, useRouter };
