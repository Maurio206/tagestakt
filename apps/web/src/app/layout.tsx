import type { Metadata, Viewport } from "next";
import { connection } from "next/server";
import { type ReactNode } from "react";

import "./globals.css";

export const metadata: Metadata = {
  title: { default: "TagesTakt", template: "%s · TagesTakt" },
  description: "Private Wochenplanung",
  robots: {
    index: false,
    follow: false,
    nocache: true,
    googleBot: { index: false, follow: false, noimageindex: true },
  },
  referrer: "no-referrer",
  formatDetection: { telephone: false, email: false, address: false },
};

export const viewport: Viewport = {
  colorScheme: "dark light",
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#11151b" },
    { media: "(prefers-color-scheme: light)", color: "#f6f7f9" },
  ],
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  // Jede Seite wird pro Request gerendert (CSP-Nonce, Anmeldestatus, keine geteilten Caches).
  await connection();
  return (
    <html lang="de">
      <body>{children}</body>
    </html>
  );
}
