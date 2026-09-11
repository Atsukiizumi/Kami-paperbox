/**
 * 账号同步桥接（分段版，docs/17）。
 *
 * 作用：登录应用账号后自动同步——登录 / 启动时拉取各段，四个 store 各自
 *      变化时防抖几秒后只推对应段（TD-09：多设备互不整份覆盖）。
 * 用法：挂在 Providers 里常驻（<AccountSyncBridge />），不渲染任何界面。
 * 为什么：拉取恢复会触发 store 变化，恢复完成后把静默窗口推过一个防抖
 *        周期，避免「刚恢复的内容」被当成新改动推回去；真实修改不受影响。
 */
import { useEffect, useRef } from "react";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import {
  markCredsDirty,
  pullAccountSync,
  pushAccountSyncSegment,
  SENSITIVE_SETTINGS_FIELDS,
  type SyncSegment,
} from "@/lib/account-sync";
import { useSettings } from "@/lib/store";
import { useTagCatalog } from "@/lib/tag-catalog";
import { useTagLexicon } from "@/lib/tag-lexicon";
import { useVaultIndex } from "@/lib/vault-index";
import { useViewHistory } from "@/lib/view-history";

const PUSH_DEBOUNCE_MS = 4_000;

/** TD-21：settings 凭据子字段的指纹（JSON 比较，数组/字符串都覆盖）。 */
function credsFingerprint(): string {
  const s = useSettings.getState() as unknown as Record<string, unknown>;
  return JSON.stringify(SENSITIVE_SETTINGS_FIELDS.map((field) => s[field] ?? null));
}

/** store → 同步段的映射：同一段的多个 store 共享一个防抖。 */
const STORE_SEGMENTS: { subscribe: (fn: () => void) => () => void; segment: SyncSegment }[] = [
  { subscribe: (fn) => useSettings.subscribe(fn), segment: "settings" },
  { subscribe: (fn) => useVaultIndex.subscribe(fn), segment: "vault" },
  { subscribe: (fn) => useTagLexicon.subscribe(fn), segment: "lexicon" },
  { subscribe: (fn) => useTagCatalog.subscribe(fn), segment: "lexicon" },
  { subscribe: (fn) => useViewHistory.subscribe(fn), segment: "history" },
];

export function AccountSyncBridge() {
  const { user, isPending } = useCurrentUserState();
  const signedIn = Boolean(user && !user.isDevFallback);
  const userId = user?.id ?? "";
  const suppressUntil = useRef(0);
  const debounces = useRef(new Map<SyncSegment, number>());
  /** TD-21：上次见到的凭据指纹；null = 尚未观察到（首事件只记基准不判脏）。 */
  const credsSeen = useRef<string | null>(null);

  // 登录 / 启动：拉一次服务端各段，比本地新就恢复
  useEffect(() => {
    if (isPending || !signedIn || !userId) return;
    let alive = true;
    suppressUntil.current = Date.now() + 5_000;
    credsSeen.current = credsFingerprint();
    pullAccountSync(userId)
      .then((r) => {
        if (!alive) return;
        // 无论是否恢复成功，窗口推过一个防抖周期：有恢复时挡住回写，没恢复时尽快放行
        suppressUntil.current = Date.now() + (r.applied.length ? PUSH_DEBOUNCE_MS + 1_500 : 0);
        if (r.applied.length) {
          for (const timer of debounces.current.values()) window.clearTimeout(timer);
        }
        // TD-21：访客期凭据已在拉取时保留——这次补推正是要把它们上送服务端，
        // 因此显式绕过静默窗口（与订阅路径的防抖同一把钥匙，不重复排程）。
        if (r.credsMerged) {
          window.clearTimeout(debounces.current.get("settings"));
          debounces.current.set(
            "settings",
            window.setTimeout(() => {
              void pushAccountSyncSegment(userId, "settings").catch(() => undefined);
            }, PUSH_DEBOUNCE_MS),
          );
        }
      })
      .catch(() => {
        if (alive) suppressUntil.current = 0;
      });
    return () => {
      alive = false;
    };
  }, [signedIn, userId, isPending]);

  // 各段变化：防抖只推对应段。到点时再判静默窗口（真实修改可能发生在窗口内）。
  // 订阅常驻（含访客态）：访客期的凭据变化要记脏（TD-21），只是不推送。
  useEffect(() => {
    const unsubs = STORE_SEGMENTS.map(({ subscribe, segment }) =>
      subscribe(() => {
        if (segment === "settings") {
          const fp = credsFingerprint();
          if (credsSeen.current === null) {
            credsSeen.current = fp;
          } else if (fp !== credsSeen.current) {
            if (!signedIn) markCredsDirty();
            credsSeen.current = fp;
          }
        }
        if (!signedIn || !userId) return;
        window.clearTimeout(debounces.current.get(segment));
        debounces.current.set(
          segment,
          window.setTimeout(() => {
            if (Date.now() < suppressUntil.current) return;
            void pushAccountSyncSegment(userId, segment).catch(() => undefined);
          }, PUSH_DEBOUNCE_MS),
        );
      }),
    );
    return () => {
      for (const unsub of unsubs) unsub();
      for (const timer of debounces.current.values()) window.clearTimeout(timer);
    };
  }, [signedIn, userId]);

  return null;
}
