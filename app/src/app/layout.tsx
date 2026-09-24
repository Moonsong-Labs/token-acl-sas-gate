import type { ReactNode } from "react";

export const metadata = {
  title: "Doors of Durin — Demo",
  description: "Token ACL gate demo, driven against a local surfnet.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          fontFamily: "'IBM Plex Sans', system-ui, sans-serif",
          background: "#f6f4ee",
          color: "#181a1f",
        }}
      >
        {children}
      </body>
    </html>
  );
}
