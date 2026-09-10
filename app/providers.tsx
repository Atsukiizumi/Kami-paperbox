"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { type ReactNode } from "react";
import { Toaster } from "sonner";
import { AuthProvider } from "@/lib/auth/provider";
import { AppShell } from "@/components/app-shell";
import { AccountSyncBridge } from "@/components/account-sync-bridge";
import { ThemeProvider, useResolvedAppearance } from "@/components/theme-provider";
import { LanTokenGate } from "@/components/lan-token-gate";
import { hydrateBrowseCache, subscribeBrowsePersist } from "@/lib/browse-cache";
import { TooltipProvider } from "@/components/ui/tooltip";

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30 * 60_000,
        gcTime: 2 * 60 * 60_000,
        retry: 1,
        refetchOnWindowFocus: false,
        refetchOnMount: false,
        refetchOnReconnect: false,
      },
    },
  });
}

function createBrowserQueryClient() {
  const client = makeQueryClient();
  hydrateBrowseCache(client);
  subscribeBrowsePersist(client);
  return client;
}

let browserQueryClient: QueryClient | undefined;

function getQueryClient() {
  if (typeof window === "undefined") return makeQueryClient();
  browserQueryClient ??= createBrowserQueryClient();
  return browserQueryClient;
}

function ThemedToaster() {
  const resolved = useResolvedAppearance();
  return (
    <Toaster
      theme={resolved}
      position="top-center"
      toastOptions={{ className: "bg-elevated text-fg border-border" }}
    />
  );
}

export function Providers({ children }: { children: ReactNode }) {
  const queryClient = getQueryClient();

  return (
    <AuthProvider>
      <QueryClientProvider client={queryClient}>
        <ThemeProvider>
          <TooltipProvider delayDuration={350} skipDelayDuration={150}>
            <LanTokenGate />
            <AccountSyncBridge />
            <AppShell>{children}</AppShell>
            <ThemedToaster />
          </TooltipProvider>
        </ThemeProvider>
      </QueryClientProvider>
    </AuthProvider>
  );
}
