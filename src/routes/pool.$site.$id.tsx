/**
 * 图站合集页。
 *
 * 作用：打开 yande.re / Konachan / Danbooru 的 pool，浏览并整包入队。
 * 用法：搜索框粘贴 https://yande.re/pool/show/99384。
 */
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { toast } from "sonner";
import { ArtworkGrid, ArtworkGridSkeleton } from "@/components/artwork-card";
import { FoldableText } from "@/components/profile-header";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { fetchSource } from "@/lib/source";
import { cookiesFromSettings, useSettings } from "@/lib/store";
import { enqueueWorks } from "@/lib/queue-runner";
import { isBooru, siteLabel } from "@/lib/sites";
import { poolOriginUrl } from "@/lib/booru";
import { flyPaperToQueue } from "@/lib/paper-fly";

export const Route = createFileRoute("/pool/$site/$id")({ component: PoolPage });

function PoolPage() {
  const { site, id } = Route.useParams();
  const src = isBooru(site) ? site : "yande";
  const safeMode = useSettings((s) => s.safeMode);

  const query = useQuery({
    queryKey: ["pool", src, id, safeMode],
    queryFn: async () => {
      const r = await fetchSource({
        data: { op: "booruPool", site: src, id, ...cookiesFromSettings() },
      });
      if (r.op !== "booruPool") throw new Error("返回异常");
      return r;
    },
  });

  if (query.isLoading) {
    return (
      <div className="space-y-4">
        <div className="h-16 rounded-lg bg-elevated" />
        <ArtworkGridSkeleton count={8} />
      </div>
    );
  }

  if (query.error || !query.data) {
    return (
      <Alert variant="danger">
        <AlertTitle>打不开合集</AlertTitle>
        <AlertDescription>
          {query.error instanceof Error ? query.error.message : "请检查链接。"}
        </AlertDescription>
      </Alert>
    );
  }

  const pool = query.data;

  function queueAll(kind: "download" | "vault") {
    enqueueWorks(pool.items, kind);
    flyPaperToQueue(document.querySelector(".kami-masonry")?.getBoundingClientRect());
    toast.success(
      kind === "vault"
        ? `已加入队列：收入纸匣 ${pool.items.length} 张`
        : `已加入队列：下载合集 ${pool.items.length} 张`,
    );
  }

  return (
    <div className="space-y-5">
      <header className="space-y-2">
        <p className="text-xs text-subtle">
          {siteLabel(src)} · 合集 {pool.id} · {pool.items.length}
          {pool.postCount > pool.items.length ? ` / ${pool.postCount}` : ""} 张
        </p>
        <h1 className="font-display text-2xl tracking-tight md:text-3xl">{pool.name}</h1>
        {pool.description ? <FoldableText text={pool.description} lines={4} /> : null}
        <div className="flex flex-wrap gap-2 pt-1">
          <Button size="sm" onClick={() => queueAll("download")} disabled={pool.items.length === 0}>
            下载合集
          </Button>
          <Button size="sm" variant="secondary" onClick={() => queueAll("vault")} disabled={pool.items.length === 0}>
            收入纸匣
          </Button>
          <Button size="sm" variant="ghost" asChild>
            <a href={poolOriginUrl(src, pool.id)} target="_blank" rel="noreferrer">
              原站
            </a>
          </Button>
        </div>
      </header>
      <ArtworkGrid items={pool.items} empty="合集里没有可显示的图。" />
      <p className="text-center text-xs text-subtle">
        <Link to="/" className="hover:text-fg">
          返回浏览
        </Link>
      </p>
    </div>
  );
}
