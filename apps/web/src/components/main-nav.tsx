"use client";

import {
  CalendarDays,
  ChartColumn,
  LayoutDashboard,
  type LucideIcon,
  Menu,
  Repeat,
  Settings,
  Sparkles,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { type ReactNode, useEffect, useRef } from "react";

const LINKS: readonly { href: string; label: string; icon: LucideIcon }[] = [
  { href: "/", label: "Übersicht", icon: LayoutDashboard },
  { href: "/wochenplan", label: "Wochenplan", icon: CalendarDays },
  { href: "/planen", label: "Planen", icon: Sparkles },
  { href: "/wiederholungen", label: "Wiederholungen", icon: Repeat },
  { href: "/auswertung", label: "Auswertung", icon: ChartColumn },
  { href: "/einstellungen", label: "Einstellungen", icon: Settings },
];

export function isActivePath(pathname: string, href: string): boolean {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
}

/** Hauptnavigation: echte Links (funktionieren ohne JavaScript), Symbol + Text. */
export function MainNav({ label = "Hauptnavigation" }: { label?: string }) {
  const pathname = usePathname();
  return (
    <nav aria-label={label}>
      <ul className="nav-list">
        {LINKS.map(({ href, label: text, icon: Icon }) => (
          <li key={href}>
            <Link
              href={href}
              className="nav-link"
              aria-current={isActivePath(pathname, href) ? "page" : undefined}
            >
              <Icon size={19} strokeWidth={1.9} aria-hidden="true" className="icon" />
              {text}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/** Menü für schmale Bildschirme (`<details>`, ohne JavaScript bedienbar). */
export function MobileMenu({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const ref = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    // Nach einem Seitenwechsel wieder schließen.
    if (ref.current) ref.current.open = false;
  }, [pathname]);
  return (
    <details className="menu" ref={ref}>
      <summary>
        <Menu size={19} strokeWidth={1.9} aria-hidden="true" />
        Menü
      </summary>
      <div className="menu-panel">{children}</div>
    </details>
  );
}
