/**
 * Planung lokaler Erinnerungen aus veröffentlichten Planblöcken. Reine Funktion – die App
 * plant das Ergebnis mit expo-notifications ein und ersetzt es bei jeder Änderung vollständig.
 *
 * Datenschutz: Standardmäßig enthalten Texte nur Kategorie und Uhrzeit. Der Blocktitel
 * erscheint nur, wenn der Benutzer „Titel anzeigen“ ausdrücklich einschaltet; Ort und
 * Notiz erscheinen nie.
 */
import {
  CATEGORY_LABELS,
  type CompletionStatus,
  type EntryCategory,
  GOAL_KEYS,
  NOT_STARTED_GRACE_MINUTES,
  type ReminderScope,
  SCHEDULE_TIMEZONE,
} from "./constants";
import { formatTime } from "./format";

const MINUTE_MS = 60_000;

export interface ReminderEntry {
  id: string;
  title: string;
  category: EntryCategory;
  completion_status: CompletionStatus;
  start_at: string;
  end_at: string;
}

export interface ReminderPreferences {
  /** Vorlauf in Minuten; `null` = keine Vorab-Erinnerung. */
  minutesBefore: number | null;
  atStart: boolean;
  ifNotStarted: boolean;
  scope: ReminderScope;
  /** Blocktitel in der Benachrichtigung zeigen (Standard: aus). */
  showDetails: boolean;
}

export type ReminderKind = "before" | "start" | "not_started";

export interface PlannedReminder {
  /** Stabiler Schlüssel – gleiche Eingaben ergeben gleiche Schlüssel. */
  key: string;
  entryId: string;
  kind: ReminderKind;
  fireAt: Date;
  title: string;
  body: string;
}

export interface ReminderPlanOptions {
  /** Nur Erinnerungen bis zu diesem Abstand einplanen (Standard 48 Stunden). */
  horizonHours?: number;
  /** Obergrenze, damit Android/iOS-Limits nie erreicht werden (Standard 40). */
  maxCount?: number;
  /** Planblöcke, zu denen bereits eine Aktivität läuft oder erfasst ist. */
  trackedEntryIds?: ReadonlySet<string>;
  timeZone?: string;
}

const IMPORTANT_CATEGORIES: readonly EntryCategory[] = [...GOAL_KEYS, "duty", "appointment"];

export function isCategoryInReminderScope(category: EntryCategory, scope: ReminderScope): boolean {
  if (scope === "all") return true;
  if (scope === "goals") return (GOAL_KEYS as readonly string[]).includes(category);
  return IMPORTANT_CATEGORIES.includes(category);
}

function prefix(entry: ReminderEntry, showDetails: boolean): string {
  return showDetails ? `${entry.title} · ` : "";
}

export function planReminders(
  entries: readonly ReminderEntry[],
  preferences: ReminderPreferences,
  now: Date,
  options: ReminderPlanOptions = {},
): PlannedReminder[] {
  const horizonMs = (options.horizonHours ?? 48) * 60 * MINUTE_MS;
  const maxCount = options.maxCount ?? 40;
  const tracked = options.trackedEntryIds ?? new Set<string>();
  const timeZone = options.timeZone ?? SCHEDULE_TIMEZONE;
  const nowMs = now.getTime();
  const reminders: PlannedReminder[] = [];

  for (const entry of entries) {
    if (entry.completion_status !== "planned") continue;
    if (!isCategoryInReminderScope(entry.category, preferences.scope)) continue;

    const startMs = Date.parse(entry.start_at);
    const label = CATEGORY_LABELS[entry.category];
    const startTime = formatTime(entry.start_at, timeZone);
    const endTime = formatTime(entry.end_at, timeZone);
    const lead = prefix(entry, preferences.showDetails);
    const candidates: Omit<PlannedReminder, "key" | "entryId">[] = [];

    if (preferences.minutesBefore !== null && preferences.minutesBefore > 0) {
      candidates.push({
        kind: "before",
        fireAt: new Date(startMs - preferences.minutesBefore * MINUTE_MS),
        title: `${lead}${label} in ${preferences.minutesBefore} Min.`,
        body: `Beginnt um ${startTime}.`,
      });
    }
    if (preferences.atStart) {
      candidates.push({
        kind: "start",
        fireAt: new Date(startMs),
        title: `${lead}${label} beginnt jetzt.`,
        body: `Geplant bis ${endTime}.`,
      });
    }
    const isGoal = (GOAL_KEYS as readonly string[]).includes(entry.category);
    const notStartedAt = startMs + NOT_STARTED_GRACE_MINUTES * MINUTE_MS;
    if (
      preferences.ifNotStarted &&
      isGoal &&
      !tracked.has(entry.id) &&
      notStartedAt < Date.parse(entry.end_at)
    ) {
      candidates.push({
        kind: "not_started",
        fireAt: new Date(notStartedAt),
        title: `${lead}${label} noch nicht gestartet`,
        body: `Geplant seit ${startTime}.`,
      });
    }

    for (const candidate of candidates) {
      const fireMs = candidate.fireAt.getTime();
      if (fireMs <= nowMs || fireMs > nowMs + horizonMs) continue;
      reminders.push({ ...candidate, entryId: entry.id, key: `${entry.id}:${candidate.kind}` });
    }
  }

  return reminders
    .sort((a, b) => a.fireAt.getTime() - b.fireAt.getTime() || a.key.localeCompare(b.key))
    .slice(0, maxCount);
}
