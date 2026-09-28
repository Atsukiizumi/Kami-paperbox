"use client";

/**
 * 搜图页「你的纸匣」块（M2-2）。
 *
 * 作用：展示与上传图近似的纸匣藏品——封面（服务端第 0 页）、标题/作者、
 *      「已收藏」标、副标距离，整卡链去作品页；空命中一行提示；unavailable
 *      （访客 401 / 服务端不可用）整块不渲染，搜图页是公开内容面不得对访客报错。
 * 用法：<VaultSearchBlock state={...} />——search 页与外站请求并行拉到结果后交进来。
 * 为什么抽成子组件：search 页是页面组件，抽出来才能按 collections-bar 先例做 RTL。
 */
import { Link } from "@/lib/kami-link";
import { Badge } from "@/components/ui/badge";
import { siteLabel } from "@/lib/sites";
import { vaultPageUrl } from "@/lib/storage/vault-sync";
import type { Source } from "@/lib/types";

export type VaultSearchMatch = {
  key: string;
  source: Source;
  id: string;
  title: string;
  author: string;
  pageCount: number;
  bytes: number;
  savedAt: number;
  hasFile: boolean;
  distance: number;
};

export type VaultSearchBlockState =
  | { state: "unavailable" }
  | { state: "ready"; matches: VaultSearchMatch[] };

export function VaultSearchBlock({ state }: { state: VaultSearchBlockState }) {
  if (state.state === "unavailable") return null;
  return (
    <section className="space-y-3">
      <h2 className="text-lg font-semibold">你的纸匣</h2>
      {state.matches.length === 0 ? (
        <p className="text-sm text-muted">纸匣里没有近似的图。</p>
      ) : (
        <ul className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
          {state.matches.map((m) => (
            <li key={m.key} className="kami-enter">
              <div className="kami-card-shell">
                <Link to="/work/$source/$id" params={{ source: m.source, id: m.id }} className="block">
                  <div className="relative aspect-[4/3] overflow-hidden bg-elevated">
                    {m.hasFile ? (
                      // 同源 /api/ 直出，不走外站代理（照 vault-dedup 的回落链简化版）
                      <img src={vaultPageUrl(m.key, 0)} alt={m.title} className="size-full object-cover" loading="lazy" />
                    ) : (
                      <div className="grid size-full place-items-center text-xs text-subtle">无预览</div>
                    )}
                    <Badge className="absolute left-2 top-2 bg-bg/80 text-fg">已收藏</Badge>
                  </div>
                  <div className="space-y-1 px-3 py-2">
                    <h3 className="line-clamp-2 text-sm font-medium text-fg">{m.title || "未命名"}</h3>
                    <p className="line-clamp-1 text-xs text-muted">{m.author || siteLabel(m.source)}</p>
                    <p className="text-xs text-subtle">距离 {m.distance}</p>
                  </div>
                </Link>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
