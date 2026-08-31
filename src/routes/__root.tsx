import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createRootRoute, HeadContent, Outlet, Scripts, type ErrorComponentProps } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Toaster } from "sonner";
import { AuthProvider } from "@/lib/auth/provider";
import { PreviewHostBridge } from "@/components/preview-host-bridge";
import { AppShell } from "@/components/app-shell";
import { ThemeProvider, useResolvedAppearance } from "@/components/theme-provider";
import { AppErrorComponent, isAbortError } from "@/lib/error-component";
import { THEME_BOOTSTRAP_SCRIPT, THEMES } from "@/lib/theme";
import appCss from "../styles.css?url";

const APP_NAME = "Kami 纸匣";

export const Route = createRootRoute({
  errorComponent: RootError,
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      {
        name: "viewport",
        content: "width=device-width, initial-scale=1, viewport-fit=cover",
      },
      { title: APP_NAME },
      {
        name: "description",
        content: "跨端个人 Pixiv / FANBOX 作品存档。公开榜单可直接浏览，登录后可备份你已能查看的内容。",
      },
      { name: "theme-color", content: THEMES.washi.dark.bg },
    ],
    links: [
      { rel: "icon", type: "image/svg+xml", href: "/favicon.svg" },
      { rel: "stylesheet", href: appCss },
      { rel: "manifest", href: "/__grok/manifest.webmanifest" },
      { rel: "apple-touch-icon", href: "/__grok/icon-180.png" },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Newsreader:opsz,wght@6..72,500;6..72,600&family=Noto+Sans+SC:wght@400;500;600&family=Noto+Serif+SC:wght@600&display=swap",
      },
    ],
  }),
  component: RootComponent,
});

function RootError({ error, reset }: ErrorComponentProps) {
  useEffect(() => {
    if (isAbortError(error)) reset();
  }, [error, reset]);
  if (isAbortError(error)) return null;
  return <AppErrorComponent error={error} />;
}

function ThemedToaster() {
  const resolved = useResolvedAppearance();
  return (
    <Toaster
      theme={resolved}
      position="top-center"
      toastOptions={{
        className: "bg-elevated text-fg border-border",
      }}
    />
  );
}

function RootComponent() {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { staleTime: 60_000, retry: 1, refetchOnWindowFocus: false },
        },
      }),
  );

  return (
    <html lang="zh-CN" className="antialiased" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP_SCRIPT }} />
        <HeadContent />
      </head>
      <body className="bg-bg text-fg">
        <PreviewHostBridge />
        <AuthProvider>
          <QueryClientProvider client={queryClient}>
            <ThemeProvider>
              <AppShell>
                <Outlet />
              </AppShell>
              <ThemedToaster />
            </ThemeProvider>
          </QueryClientProvider>
        </AuthProvider>
        <Scripts />
      </body>
    </html>
  );
}
