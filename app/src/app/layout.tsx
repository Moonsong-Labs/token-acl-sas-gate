import type { ReactNode } from "react";
import { DemoProvider } from "@/lib/client";
import "./globals.css";

export const metadata = {
  title: "Doors of Durin — Demo",
  description: "Token ACL gate demo, driven against a local surfnet.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        {/*
          A stylesheet link rather than `next/font`: the demo builds and runs
          offline against a local surfnet, and `next/font` fetches at build
          time. Every rule names a fallback stack, so the screens stay legible
          without the web fonts.
        */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          href="https://fonts.googleapis.com/css2?family=Spectral:wght@600;700&family=IBM+Plex+Sans:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        <DemoProvider>{children}</DemoProvider>
      </body>
    </html>
  );
}
