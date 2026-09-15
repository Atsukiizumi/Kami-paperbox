"use client";

/**
 * 纸匣封面取图 hook（纸匣卡片 / 随手翻一张共用）。
 *
 * 作用：按「用户文件夹原图 → 应用内 IndexedDB 像素 → 服务器第 0 页」的顺序
 *      解出一条藏品的可用封面地址与原始宽高；三处都取不到回落空串（上层画占位）。
 * 用法：const { thumb, width, height } = useVaultCover(item)。
 * 为什么：这段链路原先长在纸匣页的 VaultCard 里；「随手翻一张」的翻牌面需要
 *        一字不差的同一条链（hasVaultCover 判定翻得出的条目，卡片 / 翻牌面
 *        就都显示得出来），抽成 hook 而不是复制粘贴两份漂移。
 */
import { useEffect, useState } from "react";
import { getVaultBlob } from "@/lib/storage/vault";
import { previewFromFolder } from "@/lib/storage/persist-files";
import { vaultPageUrl } from "@/lib/storage/vault-sync";
import type { VaultMeta } from "@/lib/types";

export function useVaultCover(item: VaultMeta): { thumb: string; width?: number; height?: number } {
  const serverThumb = item.hasFile ? vaultPageUrl(item.key) : "";
  const [thumb, setThumb] = useState(serverThumb);
  const [size, setSize] = useState<{ width?: number; height?: number }>({});

  useEffect(() => {
    let cancelled = false;
    let url = "";
    void (async () => {
      const folderBlob = await previewFromFolder(item);
      const blob =
        folderBlob ||
        (await getVaultBlob(item.key, 0, { localOnly: item.hasFile === false }));
      if (cancelled) return;
      if (blob) {
        url = URL.createObjectURL(blob);
        const img = new Image();
        img.onload = () => {
          if (!cancelled) setSize({ width: img.naturalWidth, height: img.naturalHeight });
        };
        img.src = url;
        setThumb(url);
        return;
      }
      setThumb(item.hasFile ? vaultPageUrl(item.key) : "");
    })();
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps -- 依赖字段级快照：整 item 对象每渲染 identity 都变会死循环
  }, [item.key, item.relativePath, item.hasFile]);

  return { thumb, width: size.width, height: size.height };
}
