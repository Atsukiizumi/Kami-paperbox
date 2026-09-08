"use client";

/**
 * Mount once in the root so the Grok preview chrome can drive navigation
 * (and later receive registered routes). Noops when the app is not embedded.
 */

import { useEffect } from "react";
import { KNOWN_ROUTE_PATHS, useRouter } from "@/lib/kami-link";
import { installPreviewHostBridge } from "@/lib/preview-host-bridge";

export function PreviewHostBridge() {
  const router = useRouter();

  useEffect(() => {
    return installPreviewHostBridge({
      navigate: (path) => {
        router.push(path);
      },
      getRoutePaths: () => [...KNOWN_ROUTE_PATHS],
    });
  }, [router]);

  return null;
}
