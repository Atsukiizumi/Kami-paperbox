"use client";

/**
 * 主题包客户端层（everything can design · P2）。
 *
 * 作用：列表拉取（react-query）、激活包解析（两层合并的包侧来源）、缺包
 *      一次性提示与回默认、资产 URL 组装。
 * 用法：ThemeProvider / desk.tsx / appearance.tsx 调 useActiveThemePack()；
 *      管理页缩略图与 css 素材用 themeAssetUrl。
 * 为什么：包数据只在本层触网，注入方只拿结果——「用户微调 > 主题 > 默认」
 *        的合并各自发生在 ThemeProvider（shell/palette/css）与 desk（layout）。
 */
import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { useSettings } from "./store.ts";
import type { ShellSettings } from "./desk-layout.ts";
import type { ThemePackInfo } from "./theme-pack.ts";

export type ThemesResponse = { themes: ThemePackInfo[]; overLimit: number; broken: number };

async function fetchThemes(rescan: boolean): Promise<ThemesResponse> {
  const res = await fetch(rescan ? "/api/themes?rescan=1" : "/api/themes", { cache: "no-store" });
  if (!res.ok) throw new Error("主题包列表拉取失败");
  return (await res.json()) as ThemesResponse;
}

export function useThemePackList() {
  return useQuery({ queryKey: ["theme-packs"], queryFn: () => fetchThemes(false), staleTime: 30_000 });
}

/** 包内资产的本站 URL（css 里被重写后的目标、管理页缩略图都用它）。 */
export function themeAssetUrl(themeId: string, file: string): string {
  return `/api/themes/asset?theme=${encodeURIComponent(themeId)}&file=${encodeURIComponent(file)}`;
}

/**
 * 激活包解析：activeId 在列表里 → pack；不在（fetch 成功后）→ null 并一次性
 * toast（同一 id 只提一次，包回来自动恢复，不再打扰）。
 */
export function useActiveThemePack(): { list: ThemesResponse | undefined; pack: ThemePackInfo | null; loading: boolean } {
  const query = useThemePackList();
  const activeId = useSettings((s) => s.themePack.activeId);
  const themes = query.data?.themes;
  const pack = activeId && themes ? themes.find((t) => t.id === activeId) ?? null : null;
  const warnedFor = useRef<string | null>(null);

  useEffect(() => {
    if (!activeId || !themes) return;
    if (themes.some((t) => t.id === activeId)) {
      if (warnedFor.current === activeId) warnedFor.current = null; // 包回来了
      return;
    }
    if (warnedFor.current === activeId) return;
    warnedFor.current = activeId;
    toast.message(`主题包未找到：${activeId}`, {
      id: "kami-theme-pack-missing",
      description: "已回到默认观感。把包放回 themes/ 文件夹后自动恢复。",
    });
  }, [activeId, themes]);

  return { list: query.data, pack, loading: query.isPending };
}

/**
 * 合并壳层（P3 修 P2 潜伏缺陷）：激活主题包带 shell 且开「跟随」→ 包壳上位。
 * P2 只在 ThemeProvider 属性层合并，AppShell 结构读的是本地设置——zen 包会
 * 藏掉侧栏/顶栏却不给浮钮（导航不可达）。P3 起 AppShell 与 ThemeProvider
 * 共用此 hook，结构/属性一个真相源。
 */
export function useEffectiveShell(): ShellSettings {
  const local = useSettings((s) => s.shell);
  const themePack = useSettings((s) => s.themePack);
  const { pack } = useActiveThemePack();
  if (themePack.activeId && themePack.followShell && pack?.manifest.shell) return pack.manifest.shell;
  return local;
}
