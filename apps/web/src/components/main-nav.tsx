"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/", label: "Übersicht" },
  { href: "/wochenplan", label: "Wochenplan" },
  { href: "/wiederholungen", label: "Wiederholungen" },
  { href: "/einstellungen", label: "Einstellungen" },
] as const;

export function MainNav() {
  const pathname = usePathname();
  return (
    <nav aria-label="Hauptnavigation" className="main-nav">
      <ul>
        {LINKS.map((link) => {
          const active = link.href === "/" ? pathname === "/" : pathname.startsWith(link.href);
          return (
            <li key={link.href}>
              <Link href={link.href} aria-current={active ? "page" : undefined}>
                {link.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
