import Link from "next/link";

/** Zeichen: abgerundetes Quadrat mit drei steigenden Taktstrichen (eigene Zeichnung). */
export function TagesTaktMark({ size = 26 }: { size?: number }) {
  return (
    <svg
      className="brand-mark"
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      <rect x="1.5" y="1.5" width="29" height="29" rx="8.5" stroke="currentColor" strokeWidth="2" />
      <path
        d="M10 21.5v-3M16 21.5v-7M22 21.5v-11"
        stroke="currentColor"
        strokeWidth="2.6"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function Brand({ href = "/" }: { href?: string }) {
  return (
    <Link href={href} className="brand" aria-label="TagesTakt – zur Übersicht">
      <TagesTaktMark />
      <span>TagesTakt</span>
    </Link>
  );
}
