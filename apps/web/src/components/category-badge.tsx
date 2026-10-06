import { CATEGORY_COLORS, CATEGORY_LABELS, type EntryCategory } from "@tagestakt/schedule-schema";
import { type CSSProperties } from "react";

/** Kategorie als Text plus zurückhaltender Farbpunkt (Farbe ist nie alleiniger Informationsträger). */
export function CategoryBadge({ category }: { category: EntryCategory }) {
  return (
    <span
      className="category-badge"
      style={{ "--category-color": CATEGORY_COLORS[category] } as CSSProperties}
    >
      <span className="category-dot" aria-hidden="true" />
      {CATEGORY_LABELS[category]}
    </span>
  );
}
