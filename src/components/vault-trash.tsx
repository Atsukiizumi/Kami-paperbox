"use client";

/**
 * 纸篓（软删除回收站）。
 *
 * 作用：纸匣页头部入口弹出的纸篓对话框——列出已删藏品（封面/题注/删除时间/占用），
 *      支持单件「放回去」（还原）与「彻底删掉」（真删，两段确认），
 *      底部「清空纸篓」也是两段确认；动作完成后回调父层刷新两侧计数。
 * 用法：<VaultTrashDialog open={trashOpen} onOpenChange={setTrashOpen} items={trash} bytes={trashBytes} onChanged={refreshTrash} />。
 * 为什么：删除改软删后误删可救；真删是全应用唯一不可逆操作，全部两段确认、后端再设一道 confirm。
 */
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { ProxiedImg } from "@/components/proxied-img";
import { useVaultCover } from "@/components/vault-cover";
import { normalizeAuthorName } from "@/lib/author-name";
import { formatBytes } from "@/lib/utils";
import { purgeServerTrash, restoreServerTrash, type ServerTrashItem } from "@/lib/storage/vault-sync";

function formatDate(at: number): string {
  const d = new Date(at);
  return `${d.getFullYear()} 年 ${d.getMonth() + 1} 月 ${d.getDate()} 日`;
}

function TrashRow({
  item,
  onChanged,
}: {
  item: ServerTrashItem;
  onChanged: () => void;
}) {
  const { thumb } = useVaultCover(item);
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState(false);

  async function run(fn: () => Promise<boolean>, okText: string) {
    setBusy(true);
    try {
      if (await fn()) {
        toast.success(okText);
        onChanged();
      } else {
        toast.error("没做成，稍后再试");
      }
    } finally {
      setBusy(false);
      setArmed(false);
    }
  }

  const aspect = "3 / 4";
  return (
    <li className="flex items-center gap-3 border-b border-border/60 py-2.5 last:border-b-0">
      <div
        style={{ aspectRatio: aspect }}
        className="h-14 w-[42px] shrink-0 overflow-hidden rounded-md border border-border bg-elevated"
      >
        {thumb ? <ProxiedImg src={thumb} alt="" fit="cover" className="size-full" /> : null}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm">{item.title || "无题"}</p>
        <p className="mt-0.5 truncate text-xs text-subtle">
          {normalizeAuthorName(item.author) || "佚名"} · {formatBytes(item.bytes)} · {formatDate(item.deletedAt)} 删
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        <Button
          size="sm"
          variant="secondary"
          disabled={busy}
          onClick={() => void run(() => restoreServerTrash(item.key), "已放回纸匣")}
        >
          放回去
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="text-destructive"
          disabled={busy}
          onClick={() => {
            if (!armed) {
              setArmed(true);
              return;
            }
            void run(() => purgeServerTrash({ key: item.key }), "已彻底删除");
          }}
          onBlur={() => setArmed(false)}
        >
          {armed ? "再点一次确认" : "彻底删掉"}
        </Button>
      </div>
    </li>
  );
}

export function VaultTrashDialog({
  open,
  onOpenChange,
  items,
  bytes,
  onChanged,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  items: ServerTrashItem[];
  bytes: number;
  onChanged: () => void;
}) {
  const [clearArmed, setClearArmed] = useState(false);
  const [busy, setBusy] = useState(false);

  async function clearAll() {
    if (!clearArmed) {
      setClearArmed(true);
      return;
    }
    setBusy(true);
    try {
      if (await purgeServerTrash({ all: true })) {
        toast.success(`纸篓已清空（${items.length} 张）`);
        onChanged();
        onOpenChange(false);
      } else {
        toast.error("没清成，稍后再试");
      }
    } finally {
      setBusy(false);
      setClearArmed(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[80vh] flex-col sm:max-w-lg">
        <DialogTitle>纸篓</DialogTitle>
        <DialogDescription>
          删过的藏品先躺在这里，原图一直还在盘上；放回去就当没删过。彻底删掉才会真清文件。
        </DialogDescription>
        {items.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted">纸篓是空的</p>
        ) : (
          <>
            <ul className="-mx-2 min-h-0 flex-1 overflow-y-auto px-2">
              {items.map((item) => (
                <TrashRow key={item.key} item={item} onChanged={onChanged} />
              ))}
            </ul>
            <div className="mt-3 flex items-center justify-between gap-3 border-t border-border pt-3">
              <p className="text-xs text-subtle">
                共 {items.length} 张 · 约 {formatBytes(bytes)}
              </p>
              <Button
                size="sm"
                variant="ghost"
                className="text-destructive"
                disabled={busy}
                onClick={() => void clearAll()}
                onBlur={() => setClearArmed(false)}
              >
                {clearArmed ? "再点一次，清空纸篓" : "清空纸篓"}
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
