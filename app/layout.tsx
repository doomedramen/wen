import type { Metadata } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import "./globals.css";

export const metadata: Metadata = {
  title: "Wen",
  description: "Track scheduled jobs and see their projected impact on your homelab.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: `try{var theme=localStorage.getItem("wen-theme");if(theme==="light"||theme==="dark")document.documentElement.dataset.theme=theme}catch{}` }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
