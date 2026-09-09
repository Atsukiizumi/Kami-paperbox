/**
 * 账号同步桥接。
 *
 * 作用：登录应用账号后自动同步设置——登录 / 启动时拉取服务端快照，本地设置变化
 *      防抖几秒后推送。
 * 用法：挂在 Providers 里常驻（<AccountSyncBridge />），不渲染任何界面。
 * 为什么：换浏览器登录即恢复，不需要人手动点同步。拉取恢复的数据会触发 store 变化，
 *        恢复完成后把静默窗口推过一个防抖周期，避免「刚恢复的内容」被当成新改动推回去；
 *        真实的本地修改不受影响（触发时间晚于窗口即正常推送）。
 */
import { useEffect, useRef } from "react";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import { pullAccountSync, pushAccountSync } from "@/lib/account-sync";
import { useSettings } from "@/lib/store";

const PUSH_DEBOUNCE_MS = 4_000;

export function AccountSyncBridge() {
  const { user, isPending } = useCurrentUserState();
  const signedIn = Boolean(user && !user.isDevFallback);
  const userId = user?.id ?? "";
  const suppressUntil = useRef(0);
  const debounce = useRef(0);

  // 登录 / 启动：拉一次服务端快照，比本地新就恢复
  useEffect(() => {
    if (isPending || !signedIn || !userId) return;
    let alive = true;
    suppressUntil.current = Date.now() + 5_000;
    pullAccountSync(userId)
      .then((r) => {
        if (!alive) return;
        // 无论是否恢复成功，窗口推过一个防抖周期：有恢复时挡住回写，没恢复时尽快放行
        suppressUntil.current = Date.now() + (r.applied ? PUSH_DEBOUNCE_MS + 1_500 : 0);
        if (r.applied) window.clearTimeout(debounce.current);
      })
      .catch(() => {
        if (alive) suppressUntil.current = 0;
      });
    return () => {
      alive = false;
    };
  }, [signedIn, userId, isPending]);

  // 设置变化：防抖推送。触发时不再拦（真实修改可能发生在窗口内），到点时再判。
  useEffect(() => {
    if (!signedIn || !userId) return;
    const unsub = useSettings.subscribe(() => {
      window.clearTimeout(debounce.current);
      debounce.current = window.setTimeout(() => {
        if (Date.now() < suppressUntil.current) return;
        void pushAccountSync(userId).catch(() => undefined);
      }, PUSH_DEBOUNCE_MS);
    });
    return () => {
      unsub();
      window.clearTimeout(debounce.current);
    };
  }, [signedIn, userId]);

  return null;
}
