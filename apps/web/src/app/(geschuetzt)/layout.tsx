import { LogOut } from "lucide-react";
import { type ReactNode } from "react";

import { ActiveSessionCard, ActiveSessionChip } from "@/components/active-session";
import { Brand } from "@/components/brand";
import { MainNav, MobileMenu } from "@/components/main-nav";
import { stopActivityAction } from "@/server/actions/activity";
import { logoutAction } from "@/server/actions/auth";
import { requireUser } from "@/server/auth";
import { getRunningSession } from "@/server/data/activity";

function LogoutButton() {
  return (
    <form action={logoutAction}>
      <button type="submit" className="nav-link nav-link--button">
        <LogOut size={19} strokeWidth={1.9} aria-hidden="true" className="icon" />
        Abmelden
      </button>
    </form>
  );
}

/**
 * Rahmen für alle geschützten Seiten. Die Anmeldeprüfung hier ist nur eine von
 * mehreren Schichten: Jede Datenabfrage und jede Server Action prüft erneut.
 */
export default async function ProtectedLayout({ children }: { children: ReactNode }) {
  await requireUser();
  const running = await getRunningSession();
  const now = new Date();

  return (
    <>
      <a href="#inhalt" className="skip-link">
        Zum Inhalt springen
      </a>
      <div className="shell">
        <aside className="sidebar" aria-label="Seitenleiste">
          <Brand />
          <MainNav />
          <div className="sidebar-spacer" />
          <div className="sidebar-foot">
            {running ? (
              <ActiveSessionCard
                session={running}
                now={now}
                stopAction={stopActivityAction.bind(null, running.id)}
              />
            ) : null}
            <LogoutButton />
          </div>
        </aside>
        <div className="shell-main">
          <header className="topbar">
            <Brand />
            <span className="topbar-spacer" />
            {running ? <ActiveSessionChip session={running} now={now} /> : null}
            <MobileMenu>
              <MainNav label="Menü" />
              <LogoutButton />
            </MobileMenu>
          </header>
          <main id="inhalt" className="page" tabIndex={-1}>
            {children}
          </main>
        </div>
      </div>
    </>
  );
}
