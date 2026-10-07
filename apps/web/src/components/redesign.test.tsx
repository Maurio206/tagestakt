/**
 * Tests der neuen Oberfläche: Wochenwahl (Datumsfeld bleibt synchron), Timer, Ziele,
 * Jetzt-Fläche, Zeitraster und Wiederholungen mit mehreren Wochentagen.
 */
import {
  type ActivitySession,
  type CompletionStatus,
  type EntryCategory,
  type ScheduleEntry,
  getWeekGoals,
  resolveTimeRange,
} from "@tagestakt/schedule-schema";
import { act, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
  usePathname: () => "/wochenplan",
}));

const { GoalList, GoalTable } = await import("./goal-progress");
const { LiveTimer } = await import("./live-timer");
const { MainNav } = await import("./main-nav");
const { NowPanel } = await import("./now-panel");
const { RecurringForm } = await import("./recurring-form");
const { WeekGrid, placeSegments } = await import("./week-grid");
const { WeekPicker } = await import("./week-picker");

const OWNER = "8f14e45f-ceea-4f6a-9d1b-6d2c4f0a9b11";
const WEEK = "c9f0f895-fb98-4b91-9f5a-1c2d3e4f5a6b";

function entry(
  id: string,
  title: string,
  category: EntryCategory,
  date: string,
  start: string,
  end: string,
  options: { nextDay?: boolean; completion?: CompletionStatus } = {},
): ScheduleEntry {
  const range = resolveTimeRange(date, start, end, options.nextDay ?? false);
  return {
    id,
    owner_id: OWNER,
    schedule_week_id: WEEK,
    title,
    category,
    start_at: range.start.toISOString(),
    end_at: range.end.toISOString(),
    location: null,
    note: null,
    source: "manual",
    completion_status: options.completion ?? "planned",
    created_at: "2026-10-01T00:00:00+00:00",
    updated_at: "2026-10-01T00:00:00+00:00",
  };
}

function session(
  goal: ActivitySession["goal_category"],
  startedAt: string,
  endedAt: string | null,
  scheduleEntryId: string | null = null,
): ActivitySession {
  return {
    id: "6f1c2d3e-4a5b-4c6d-8e7f-9a0b1c2d3e4f",
    owner_id: OWNER,
    schedule_entry_id: scheduleEntryId,
    goal_category: goal,
    title: "Kundenprojekt (Beispiel)",
    started_at: startedAt,
    ended_at: endedAt,
    corrected_at: null,
    created_at: startedAt,
    updated_at: startedAt,
  };
}

/** Platzhalter-Actions: Komponenten erhalten Server Actions ausschließlich als Props. */
const stubAction = vi.fn(async () => ({ status: "idle" as const }));
const stubActions = {
  start: () => stubAction,
  stop: () => stubAction,
  discard: () => stubAction,
  switchTo: () => stubAction,
  setCompletion: () => stubAction,
};

const FORBIDDEN_WORDS = /einloggen|ausloggen|einstempeln|ausstempeln/i;

describe("WeekPicker", () => {
  const props = (weekStart: string) => ({
    weekStart,
    previousHref: "/wochenplan?woche=prev",
    todayHref: "/wochenplan",
    nextHref: "/wochenplan?woche=next",
    action: "/wochenplan",
  });

  it("hält das Datumsfeld nach „Folgewoche“ synchron zur angezeigten Woche", () => {
    const { rerender } = render(<WeekPicker {...props("2026-10-12")} />);
    const field = screen.getByLabelText("Woche wählen (beliebiger Tag)");
    expect(field).toHaveValue("2026-10-12");
    // Client-Navigation: gleiche Komponente, neue Woche → das Feld muss mitziehen.
    rerender(<WeekPicker {...props("2026-10-19")} />);
    expect(screen.getByLabelText("Woche wählen (beliebiger Tag)")).toHaveValue("2026-10-19");
  });

  it("bietet Vorwoche, Heute und Folgewoche als echte Links", () => {
    render(<WeekPicker {...props("2026-10-12")} />);
    const nav = screen.getByRole("navigation", { name: "Woche wechseln" });
    expect(within(nav).getByRole("link", { name: /Folgewoche/ })).toHaveAttribute(
      "href",
      "/wochenplan?woche=next",
    );
  });
});

describe("LiveTimer", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-12T16:04:07Z"));
  });
  afterEach(() => vi.useRealTimers());

  it("zeigt Laufzeit ab Serverbeginn und eine minutengenaue Beschreibung", () => {
    render(<LiveTimer startedAt="2026-10-12T15:00:00Z" initialNow="2026-10-12T16:04:07Z" />);
    const timer = screen.getByRole("timer");
    expect(timer).toHaveTextContent("1:04:07");
    expect(timer).toHaveAttribute("aria-label", "Läuft seit 1 Stunde 4 Minuten");
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(timer).toHaveTextContent("1:04:08");
  });
});

describe("Ziele", () => {
  const now = new Date("2026-10-14T10:00:00Z");
  const goals = getWeekGoals({
    targets: { business: 1200, sport: null, relationship: 240 },
    entries: [entry("a", "Kundenprojekt (Beispiel)", "business", "2026-10-15", "17:00", "19:00")],
    sessions: [session("business", "2026-10-12T15:00:00Z", "2026-10-12T18:00:00Z")],
    weekStart: "2026-10-12",
    now,
  });

  it("zeigt Status als Wort, nie „erreicht“ ohne Ziel", () => {
    render(<GoalList goals={goals} />);
    expect(screen.getAllByText("Gefährdet")).toHaveLength(2);
    expect(screen.getByText("Ziel noch festlegen")).toBeInTheDocument();
    expect(screen.queryByText("Erreicht")).not.toBeInTheDocument();
    expect(screen.getByText("Für Sport ist noch kein Wochenziel festgelegt.")).toBeInTheDocument();
    expect(
      screen.getByText("Dir fehlen noch 17 h Gewerbe. Eingeplant sind noch 2 h."),
    ).toBeInTheDocument();
  });

  it("bilanziert Ziel, geplant, erfasst und Differenz", () => {
    render(<GoalTable goals={goals} caption="Bilanz" />);
    const business = screen.getByRole("row", { name: /Gewerbe/ });
    expect(
      within(business)
        .getAllByRole("cell")
        .map((c) => c.textContent),
    ).toEqual(["20 h", "2 h", "3 h", "−17 h", "Gefährdet"]);
    const sport = screen.getByRole("row", { name: /Sport/ });
    expect(within(sport).getAllByRole("cell")[0]).toHaveTextContent("–");
  });
});

describe("NowPanel", () => {
  const now = new Date("2026-10-12T15:30:00Z"); // Mo 17:30 Berlin
  const business = entry(
    "b1",
    "Kundenprojekt (Beispiel)",
    "business",
    "2026-10-12",
    "17:00",
    "20:00",
  );
  const sport = entry("s1", "Krafttraining (Beispiel)", "sport", "2026-10-12", "17:00", "18:00");
  const duty = entry("d1", "Dienst (Beispiel)", "duty", "2026-10-12", "07:00", "18:00");

  it("Zielblock ohne Aktivität: „Fokus starten“ und Hinweis „Noch nicht erfasst“", () => {
    render(
      <NowPanel
        now={now}
        running={null}
        current={business}
        next={undefined}
        trackedEntryIds={new Set()}
        actions={stubActions}
      />,
    );
    expect(screen.getByRole("button", { name: /Fokus starten/ })).toBeInTheDocument();
    expect(screen.getByText("Noch nicht erfasst.")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "„Kundenprojekt (Beispiel)“ als erledigt markieren" }),
    ).toBeInTheDocument();
  });

  it("anderer Block: kein Fokus-Knopf, Status-Aktionen bleiben", () => {
    render(
      <NowPanel
        now={now}
        running={null}
        current={duty}
        next={undefined}
        trackedEntryIds={new Set()}
        actions={stubActions}
      />,
    );
    expect(screen.queryByRole("button", { name: /Fokus starten/ })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /als ausgelassen markieren/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Aktivität Sport starten" })).toBeInTheDocument();
  });

  it("freie Zeit: Aktivität für Gewerbe, Sport oder Laila starten", () => {
    render(
      <NowPanel
        now={now}
        running={null}
        current={undefined}
        next={undefined}
        trackedEntryIds={new Set()}
        actions={stubActions}
      />,
    );
    expect(screen.getByText("Gerade nichts geplant")).toBeInTheDocument();
    for (const label of ["Gewerbe", "Sport", "Laila"]) {
      expect(
        screen.getByRole("button", { name: `Aktivität ${label} starten` }),
      ).toBeInTheDocument();
    }
  });

  it("laufende Aktivität: Timer, Beenden, Zeit korrigieren, Abbrechen und Wechsel", () => {
    const running = session("business", "2026-10-12T15:00:00Z", null, business.id);
    const { container } = render(
      <NowPanel
        now={now}
        running={running}
        current={sport}
        next={undefined}
        trackedEntryIds={new Set()}
        actions={stubActions}
      />,
    );
    expect(screen.getByRole("timer")).toHaveTextContent("30:00");
    expect(screen.getByRole("button", { name: /Beenden/ })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Zeit korrigieren" })).toHaveAttribute(
      "href",
      expect.stringContaining("korrigieren="),
    );
    expect(screen.getByRole("button", { name: /Abbrechen/ })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Gewerbe beenden, Sport starten" }),
    ).toBeInTheDocument();
    expect(container.textContent ?? "").not.toMatch(FORBIDDEN_WORDS);
  });

  it("über 24 Stunden: Beenden nur über „Zeit korrigieren“", () => {
    const old = session("sport", "2026-10-11T10:00:00Z", null);
    render(
      <NowPanel
        now={now}
        running={old}
        current={undefined}
        next={undefined}
        trackedEntryIds={new Set()}
        actions={stubActions}
      />,
    );
    expect(screen.queryByRole("button", { name: /^Beenden/ })).not.toBeInTheDocument();
    expect(screen.getByText(/Vermutlich vergessen/)).toBeInTheDocument();
  });
});

describe("Zeitraster", () => {
  it("legt überschneidende Blöcke nebeneinander", () => {
    const placed = placeSegments([
      {
        entry: entry("a", "A", "duty", "2026-10-12", "07:00", "16:30"),
        from: 420,
        to: 990,
        continued: false,
      },
      {
        entry: entry("b", "B", "appointment", "2026-10-12", "12:00", "12:30"),
        from: 720,
        to: 750,
        continued: false,
      },
      {
        entry: entry("c", "C", "meal", "2026-10-12", "18:00", "19:00"),
        from: 1080,
        to: 1140,
        continued: false,
      },
    ]);
    expect(placed.map((p) => [p.entry.id, p.lane, p.lanes])).toEqual([
      ["a", 0, 2],
      ["b", 1, 2],
      ["c", 0, 1],
    ]);
  });

  it("verlinkt Blöcke im Entwurf und zeigt Fortsetzungen über Mitternacht", () => {
    const sleep = entry("z", "Schlaf (Beispiel)", "sleep", "2026-10-12", "23:00", "06:30", {
      nextDay: true,
    });
    render(
      <WeekGrid
        weekStart="2026-10-12"
        entries={[sleep]}
        overlapIds={new Set()}
        today="2026-10-13"
        now={new Date("2026-10-13T08:00:00Z")}
        editHref={(e) => `/wochenplan?bearbeiten=${e.id}`}
      />,
    );
    const links = screen.getAllByRole("link", { name: /Schlaf \(Beispiel\)/ });
    expect(links).toHaveLength(2);
    expect(links[1]).toHaveAccessibleName(/Fortsetzung vom Vortag/);
  });
});

describe("Navigation", () => {
  it("markiert die aktuelle Seite und nennt alle Bereiche mit Text", () => {
    render(<MainNav />);
    expect(screen.getByRole("link", { name: "Wochenplan" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    for (const label of ["Übersicht", "Wiederholungen", "Auswertung", "Einstellungen"]) {
      expect(screen.getByRole("link", { name: label })).not.toHaveAttribute("aria-current");
    }
  });
});

describe("RecurringForm mit mehreren Wochentagen", () => {
  it("bietet Wochentage einzeln und die Abkürzung „Werktage“", () => {
    render(
      <RecurringForm
        action={vi.fn()}
        idPrefix="neu"
        submitLabel="Anlegen"
        multipleWeekdays
        defaults={{
          title: "",
          category: "duty",
          weekday: "1,3",
          startTime: "07:00",
          endTime: "16:30",
          location: "",
          note: "",
          active: true,
        }}
      />,
    );
    expect(screen.getByRole("checkbox", { name: "Montag" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Dienstag" })).not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Mittwoch" })).toBeChecked();
    expect(screen.getByLabelText("Werktage (Montag bis Freitag)")).toBeInTheDocument();
  });
});
