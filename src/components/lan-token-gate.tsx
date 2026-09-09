"use client";

/**
 * 局域网配对闸（SEC-01 关闭态的用户面）。
 *
 * 作用：应用账号关闭（VITE_AUTH_ENABLED=false）时，数据面 API 只认启动令牌。
 *      本组件负责：识别地址栏 #pair=<token> 完成首次配对（写 SameSite=Strict
 *      cookie）、无令牌/令牌失效时弹配对输入框、监听全局数据面 401。
 * 用法：挂在 Providers 里一次；账号开启时整个组件是 null，零开销。
 */
import { useEffect, useRef, useState, type FormEvent } from "react";
import { KeyRound } from "lucide-react";
import { authEnabled } from "@/lib/auth/client";
import {
  hasLanTokenCookie,
  isValidLanTokenShape,
  pairingTokenFromLocation,
  setLanTokenCookie,
  stripPairingHash,
} from "@/lib/lan-pairing";

export function LanTokenGate() {
  const [needed, setNeeded] = useState(false);
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const askedRef = useRef(false);

  useEffect(() => {
    if (authEnabled) return;

    // 1) 打开配对链接：写入 cookie、抹掉 hash、整页刷新让 <img> 也带上。
    const fromHash = pairingTokenFromLocation();
    if (fromHash) {
      stripPairingHash();
      if (!hasLanTokenCookie() && isValidLanTokenShape(fromHash) && setLanTokenCookie(fromHash)) {
        window.location.reload();
        return;
      }
    }

    // 2) 没有 cookie 时先探测一次，首屏就给出配对框而不是满屏 401。
    if (!hasLanTokenCookie()) {
      fetch("/api/proxy", { cache: "no-store" })
        .then((res) => {
          if (res.status === 401) ask();
        })
        .catch(() => undefined);
    }

    // 3) 兜底监听：任何同源数据面 401（含令牌被换掉）都弹框。
    //    /api/auth 是账号体系自己的 401；/api/account/sync 在账号关闭时恒 401。
    const originalFetch = window.fetch.bind(window);
    window.fetch = async (input, init) => {
      const res = await originalFetch(input, init);
      if (res.status === 401) {
        const url =
          typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        const sameOrigin = url.startsWith("/") || url.startsWith(window.location.origin);
        if (sameOrigin && url.includes("/api/") && !url.includes("/api/auth") && !url.includes("/api/account/sync")) {
          ask();
        }
      }
      return res;
    };
    return () => {
      window.fetch = originalFetch;
    };
  }, []);

  function ask() {
    if (askedRef.current) return;
    askedRef.current = true;
    setNeeded(true);
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    const token = value.trim();
    if (!isValidLanTokenShape(token)) {
      setError("令牌格式不对，请从服务端启动日志完整复制");
      return;
    }
    if (!setLanTokenCookie(token)) {
      setError("浏览器拒绝了 cookie（隐私模式？），请换普通窗口打开");
      return;
    }
    window.location.reload();
  }

  if (authEnabled || !needed) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-bg/80 p-4 backdrop-blur-sm">
      <form
        onSubmit={submit}
        className="w-full max-w-sm rounded-xl border border-border bg-elevated p-6 shadow-xl"
      >
        <div className="mb-2 flex items-center gap-2 text-fg">
          <KeyRound className="size-5" />
          <h2 className="text-base font-semibold">需要配对令牌</h2>
        </div>
        <p className="mb-4 text-sm leading-relaxed text-muted">
          这台浏览器还没和纸匣服务端配对。令牌在启动纸匣的终端里（一行
          <code className="mx-1 rounded bg-bg px-1 py-0.5 text-xs">[kami] 局域网访问令牌</code>
          开头），也在服务端的 .data/lan-token.json 文件里。
        </p>
        <input
          autoFocus
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            setError(null);
          }}
          placeholder="粘贴配对令牌"
          className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm text-fg outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
        />
        {error ? <p className="mt-2 text-xs text-red-500">{error}</p> : null}
        <button
          type="submit"
          className="mt-4 w-full cursor-pointer rounded-lg bg-accent px-3 py-2 text-sm font-medium text-accent-fg transition-colors hover:bg-accent/90"
        >
          配对并继续
        </button>
      </form>
    </div>
  );
}
