import type { ReactNode } from "react";
import { THEME_BOOTSTRAP_SCRIPT, THEMES } from "@/lib/theme";
import { Providers } from "./providers";
import "../src/styles.css";

export const metadata = {
  title: "Kami 纸匣",
  description: "跨端个人 Pixiv / FANBOX 作品存档。",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="zh-CN" className="antialiased" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP_SCRIPT }} />
        <meta name="theme-color" content={THEMES.washi.dark.bg} />
        <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
      </head>
      <body className="bg-bg text-fg">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
