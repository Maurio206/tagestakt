import { categoryTone } from "@tagestakt/design-tokens";
import { CATEGORY_LABELS, type EntryCategory } from "@tagestakt/schedule-schema";

import { ToneIcon } from "./icons";

/** Kategorie als Text plus Symbol in zurückhaltender Farbe (Farbe ist nie alleiniger Träger). */
export function CategoryBadge({ category }: { category: EntryCategory }) {
  const tone = categoryTone[category];
  return (
    <span className={`cat tone-${tone}`}>
      <ToneIcon tone={tone} size={15} />
      {CATEGORY_LABELS[category]}
    </span>
  );
}
