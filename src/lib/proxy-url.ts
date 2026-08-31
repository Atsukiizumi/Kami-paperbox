const SCHEMES = new Set(["http:", "https:", "socks4:", "socks5:", "socks5h:"]);

export type ProxyParse =
  | { ok: true; href: string }
  | { ok: false; error: string };

export function parseProxyUrl(raw: string): ProxyParse {
  const v = raw.trim();
  if (!v) return { ok: true, href: "" };
  if (v.length > 512) return { ok: false, error: "地址太长" };
  const candidate = /^[a-z][a-z0-9+.-]*:\/\//i.test(v) ? v : `http://${v}`;
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return { ok: false, error: "代理地址格式不对，例如 http://127.0.0.1:7890" };
  }
  if (!SCHEMES.has(url.protocol)) {
    return { ok: false, error: "只支持 http / https / socks5 代理" };
  }
  if (!url.hostname) return { ok: false, error: "缺少主机" };
  if (url.hostname === "0.0.0.0" || url.hostname === "::") {
    return { ok: false, error: "主机无效" };
  }
  const port = url.port
    ? Number(url.port)
    : url.protocol === "https:"
      ? 443
      : url.protocol.startsWith("socks")
        ? 1080
        : 80;
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    return { ok: false, error: "端口无效" };
  }
  const auth = url.username
    ? `${encodeURIComponent(decodeURIComponent(url.username))}${
        url.password ? `:${encodeURIComponent(decodeURIComponent(url.password))}` : ""
      }@`
    : "";
  return { ok: true, href: `${url.protocol}//${auth}${url.hostname}:${port}` };
}

export function maskProxyUrl(href: string): string {
  if (!href) return "";
  try {
    const url = new URL(href);
    if (url.password) url.password = "****";
    return `${url.protocol}//${url.username ? `${url.username}${url.password ? ":****" : ""}@` : ""}${url.hostname}${url.port ? `:${url.port}` : ""}`;
  } catch {
    return href;
  }
}
