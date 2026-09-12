"use client";

/**
 * 画师页「追踪」按钮（A）。
 *
 * 作用：切换设置段里的追踪条目；满员/成功/取消都有提示。
 * 用法：<WatchToggle source="pixiv" id={profile.id} name avatar />。
 */
import { Bell, BellOff } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useSettings } from "@/lib/store";
import type { WatchSource } from "@/lib/watch";

export function WatchToggle({ source, id, name, avatar }: { source: WatchSource; id: string; name: string; avatar: string }) {
  const watched = useSettings((s) => s.watchArtists.some((w) => w.source === source && w.id === id));
  const toggle = useSettings((s) => s.toggleWatchArtist);
  return (
    <Button
      size="sm"
      variant={watched ? "secondary" : "outline"}
      className="mt-2"
      onClick={() => {
        const result = toggle({ source, id, name, avatar });
        if (result === "full") toast.error("追踪列表已满，先取消一些或在追踪页调高上限");
        else if (result === "added") toast.success(`已追踪 ${name}，有新作会在「追踪」页提醒`);
        else toast.success("已取消追踪");
      }}
    >
      {watched ? <Bell className="size-4" /> : <BellOff className="size-4" />}
      {watched ? "已追踪" : "追踪"}
    </Button>
  );
}
