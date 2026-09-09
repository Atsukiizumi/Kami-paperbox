import type { ReactNode } from "react";
import { THEME_BOOTSTRAP_SCRIPT, THEMES } from "@/lib/theme";
import { Providers } from "./providers";
import "../src/styles.css";

export const metadata = {
  title: "Kami 纸匣",
  description: "跨端个人 Pixiv / FANBOX 作品存档。公开榜单可直接浏览，登录后可备份你已能查看的内容。",
  icons: { icon: [{ url: "/favicon.svg", type: "image/svg+xml" }] },
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover" as const,
  themeColor: THEMES.washi.dark.bg,
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="zh-CN" className="antialiased" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP_SCRIPT }} />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Newsreader:opsz,wght@6..72,600&family=Noto+Sans+SC:wght@400;500&display=swap"
        />
      </head>
      <body className="bg-bg text-fg">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
