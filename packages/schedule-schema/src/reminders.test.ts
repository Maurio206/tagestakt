import { describe, expect, it } from "vitest";

import type { CompletionStatus, EntryCategory } from "./constants";
import {
  type ReminderEntry,
  type ReminderPreferences,
  isCategoryInReminderScope,
  planReminders,
  trackedEntryIdsFromSessions,
} from "./reminders";

function entry(
  id: string,
  category: EntryCategory,
  startAt: string,
  endAt: string,
  completion: CompletionStatus = "planned",
): ReminderEntry {
  return {
    id,
    title: `Block ${id} (Beispiel)`,
    category,
    completion_status: completion,
    start_at: startAt,
    end_at: endAt,
  };
}

const defaults: ReminderPreferences = {
  minutesBefore: 10,
  atStart: true,
  ifNotStarted: true,
  scope: "important",
  showDetails: false,
};

// Montag 12.10.2026, 12:00 Berlin (UTC+2)
const now = new Date("2026-10-12T10:00:00Z");

describe("Erinnerungsumfang", () => {
  it("filtert Kategorien je Umfang", () => {
    expect(isCategoryInReminderScope("business", "goals")).toBe(true);
    expect(isCategoryInReminderScope("duty", "goals")).toBe(false);
    expect(isCategoryInReminderScope("duty", "important")).toBe(true);
    expect(isCategoryInReminderScope("appointment", "important")).toBe(true);
    expect(isCategoryInReminderScope("meal", "important")).toBe(false);
    expect(isCategoryInReminderScope("meal", "all")).toBe(true);
  });
});

describe("planReminders", () => {
  // Gewerbe 17:00–20:00 Berlin
  const business = entry("a", "business", "2026-10-12T15:00:00Z", "2026-10-12T18:00:00Z");

  it("plant Vorab-, Beginn- und Nicht-gestartet-Erinnerung ohne Details", () => {
    const reminders = planReminders([business], defaults, now);
    expect(reminders.map((r) => [r.kind, r.fireAt.toISOString(), r.title, r.body])).toEqual([
      ["before", "2026-10-12T14:50:00.000Z", "Gewerbe in 10 Min.", "Beginnt um 17:00."],
      ["start", "2026-10-12T15:00:00.000Z", "Gewerbe beginnt jetzt.", "Geplant bis 20:00."],
      [
        "not_started",
        "2026-10-12T15:10:00.000Z",
        "Gewerbe noch nicht gestartet",
        "Geplant seit 17:00.",
      ],
    ]);
    for (const reminder of reminders) {
      expect(`${reminder.title} ${reminder.body}`).not.toContain("Beispiel");
    }
  });

  it("zeigt den Titel nur nach ausdrücklicher Freigabe", () => {
    const reminders = planReminders([business], { ...defaults, showDetails: true }, now);
    expect(reminders[0]?.title).toBe("Block a (Beispiel) · Gewerbe in 10 Min.");
  });

  it("verwendet stabile Schlüssel", () => {
    const keys = planReminders([business], defaults, now).map((r) => r.key);
    expect(keys).toEqual(["a:before", "a:start", "a:not_started"]);
    expect(planReminders([business], defaults, now).map((r) => r.key)).toEqual(keys);
  });

  it("lässt Vergangenes, Erledigtes, Ausgelassenes und bereits Erfasstes weg", () => {
    const reminders = planReminders(
      [
        entry("past", "business", "2026-10-12T08:00:00Z", "2026-10-12T09:00:00Z"),
        entry("done", "sport", "2026-10-12T16:00:00Z", "2026-10-12T17:00:00Z", "completed"),
        entry("skip", "sport", "2026-10-12T16:00:00Z", "2026-10-12T17:00:00Z", "skipped"),
        business,
      ],
      defaults,
      now,
      { trackedEntryIds: new Set(["a"]) },
    );
    expect(reminders.map((r) => r.key)).toEqual(["a:before", "a:start"]);
  });

  it("erinnert bei Dienst, aber „noch nicht gestartet“ nur bei Zielen", () => {
    const duty = entry("d", "duty", "2026-10-13T05:00:00Z", "2026-10-13T14:30:00Z");
    const reminders = planReminders([duty], defaults, now);
    expect(reminders.map((r) => r.title)).toEqual(["Dienst in 10 Min.", "Dienst beginnt jetzt."]);
  });

  it("respektiert ausgeschaltete Einzelerinnerungen und Horizont", () => {
    const later = entry("later", "sport", "2026-10-16T16:00:00Z", "2026-10-16T17:00:00Z");
    const reminders = planReminders(
      [business, later],
      { ...defaults, minutesBefore: null, ifNotStarted: false },
      now,
    );
    expect(reminders.map((r) => r.key)).toEqual(["a:start"]);
  });

  it("rechnet nach dem Ende der Sommerzeit in Winterzeit (UTC+1)", () => {
    // Sonntag 25.10.2026, 09:00 Berlin = 08:00 UTC
    const sunday = entry("s", "sport", "2026-10-25T08:00:00Z", "2026-10-25T09:00:00Z");
    const reminders = planReminders([sunday], defaults, new Date("2026-10-24T12:00:00Z"));
    expect(reminders[0]?.fireAt.toISOString()).toBe("2026-10-25T07:50:00.000Z");
    expect(reminders[0]?.body).toBe("Beginnt um 09:00.");
  });

  it("begrenzt die Anzahl und sortiert nach Zeitpunkt", () => {
    const many = Array.from({ length: 30 }, (_, i) =>
      entry(
        `m${String(i).padStart(2, "0")}`,
        "business",
        new Date(now.getTime() + (i + 1) * 3_600_000).toISOString(),
        new Date(now.getTime() + (i + 1) * 3_600_000 + 1_800_000).toISOString(),
      ),
    );
    const reminders = planReminders(many, defaults, now, { maxCount: 5 });
    expect(reminders).toHaveLength(5);
    const times = reminders.map((r) => r.fireAt.getTime());
    expect([...times].sort((a, b) => a - b)).toEqual(times);
  });
});

describe("trackedEntryIdsFromSessions", () => {
  const block = entry("g", "business", "2026-10-12T15:00:00Z", "2026-10-12T18:00:00Z");
  const now = new Date("2026-10-12T15:05:00Z");

  it("erkennt verknüpfte und laufende Aktivitäten desselben Ziels", () => {
    expect(
      trackedEntryIdsFromSessions(
        [block],
        [
          {
            goal_category: "business",
            schedule_entry_id: null,
            started_at: "2026-10-12T14:55:00Z",
            ended_at: null,
          },
        ],
        now,
      ),
    ).toEqual(new Set(["g"]));
    expect(
      trackedEntryIdsFromSessions(
        [block],
        [
          {
            goal_category: "sport",
            schedule_entry_id: "x",
            started_at: "2026-10-12T14:55:00Z",
            ended_at: null,
          },
        ],
        now,
      ),
    ).toEqual(new Set(["x"]));
  });

  it("ignoriert Aktivitäten, die vor Blockbeginn endeten", () => {
    expect(
      trackedEntryIdsFromSessions(
        [block],
        [
          {
            goal_category: "business",
            schedule_entry_id: null,
            started_at: "2026-10-12T12:00:00Z",
            ended_at: "2026-10-12T13:00:00Z",
          },
        ],
        now,
      ).size,
    ).toBe(0);
  });
});
