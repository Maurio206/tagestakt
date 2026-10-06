import Link from "next/link";
import { type ReactNode } from "react";

import { MainNav } from "@/components/main-nav";
import { requireUser } from "@/server/auth";

/**
 * Rahmen für alle geschützten Seiten. Die Anmeldeprüfung hier ist nur eine von
 * mehreren Schichten: Jede Datenabfrage und jede Server Action prüft erneut.
 */
export default async function ProtectedLayout({ children }: { children: ReactNode }) {
  await requireUser();
  return (
    <>
      <a href="#inhalt" className="skip-link">
        Zum Inhalt springen
      </a>
      <header className="app-header">
        <Link href="/" className="brand">
          TagesTakt
        </Link>
        <MainNav />
      </header>
      <main id="inhalt" className="page">
        {children}
      </main>
    </>
  );
}
