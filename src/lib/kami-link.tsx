/**
 * 站内跳转。Next.js 用 next/link；参数路由仍写成 `/work/$source/$id`。
 */
"use client";

import NextLink from "next/link";
import { useRouter } from "next/navigation";
import type { ComponentProps, ReactNode } from "react";

export function fillPath(to: string, params?: Record<string, string>) {
  if (!params) return to;
  return to.replace(/\$([A-Za-z0-9_]+)/g, (_, key: string) => encodeURIComponent(params[key] ?? ""));
}

type LinkProps = {
  to?: string;
  href?: string;
  params?: Record<string, string>;
  hash?: string;
  children?: ReactNode;
  className?: string;
  resetScroll?: boolean;
} & Omit<ComponentProps<typeof NextLink>, "href">;

export function Link({ to, href, params, hash, resetScroll, ...rest }: LinkProps) {
  let path = href ?? to ?? "/";
  path = fillPath(path, params);
  if (hash) path = `${path}#${hash}`;
  return <NextLink href={path} scroll={resetScroll === false ? false : undefined} {...rest} />;
}

export function useNavigate() {
  const router = useRouter();
  return (opts: string | { to: string; params?: Record<string, string> }) => {
    const path = typeof opts === "string" ? opts : fillPath(opts.to, opts.params);
    router.push(path);
  };
}
