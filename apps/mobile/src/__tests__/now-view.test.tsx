import {
  type PlanSnapshot,
  type ScheduleEntry,
  resolveTimeRange,
} from "@tagestakt/schedule-schema";
import { render, screen } from "@testing-library/react-native";

import { LoginView } from "@/components/login-view";
import { NowView } from "@/components/now-view";
import { type PlanResult } from "@/lib/plan-status";

const OWNER = "8f14e45f-ceea-4f6a-9d1b-6d2c4f0a9b11";
const WEEK = "c9f0f895-fb98-4b91-9f5a-1c2d3e4f5a6b";

let counter = 0;
function entry(
  title: string,
  category: ScheduleEntry["category"],
  date: string,
  start: string,
  end: string,
  completion: ScheduleEntry["completion_status"] = "planned",
): ScheduleEntry {
  const range = resolveTimeRange(date, start, end, false);
  counter += 1;
  return {
    id: `00000000-0000-4000-8000-${String(counter).padStart(12, "0")}`,
    owner_id: OWNER,
    schedule_week_id: WEEK,
    title,
    category,
    start_at: range.start.toISOString(),
    end_at: range.end.toISOString(),
    location: null,
    note: null,
    source: "manual",
    completion_status: completion,
    created_at: "2026-10-01T00:00:00+00:00",
    updated_at: "2026-10-01T00:00:00+00:00",
  };
}

function snapshot(fetchedAt: string): PlanSnapshot {
  return {
    schemaVersion: 2,
    fetchedAt,
    goalTargets: { business: 1200, sport: null, relationship: null },
    reminderSettings: {
      minutesBefore: 10,
      atStart: true,
      ifNotStarted: false,
      scope: "important" as const,
    },
    sessions: [],
    timezone: "Europe/Berlin",
    weeks: [
      {
        id: WEEK,
        owner_id: OWNER,
        week_start: "2026-10-05",
        version: 2,
        status: "published",
        planning_note: null,
        published_at: "2026-10-04T18:00:00+00:00",
        created_at: "2026-10-04T17:00:00+00:00",
        updated_at: "2026-10-04T18:00:00+00:00",
        schedule_entries: [
          entry("Fokusblock (Beispiel)", "business", "2026-10-05", "15:00", "20:00", "completed"),
          entry("Gewerbe-Block (Beispiel)", "business", "2026-10-06", "15:30", "19:30"),
          entry("Training (Beispiel)", "sport", "2026-10-06", "19:45", "20:45"),
        ],
      },
    ],
  };
}

// Dienstag, 06.10.2026, 17:00 Uhr Berliner Zeit (= 15:00 UTC)
const NOW = new Date("2026-10-06T15:00:00Z");

describe("NowView (Smoke-Test der Hauptansicht)", () => {
  it("zeigt Uhrzeit, laufenden Block, Restzeit und nächsten Block", async () => {
    const result: PlanResult = {
      snapshot: snapshot("2026-10-06T14:55:00.000Z"),
      origin: "network",
    };
    await render(<NowView result={result} now={NOW} />);

    expect(screen.getByText("17:00")).toBeOnTheScreen();
    expect(screen.getByText("Gewerbe-Block (Beispiel)")).toBeOnTheScreen();
    expect(screen.getByText("15:30–19:30")).toBeOnTheScreen();
    expect(screen.getByText("noch 2 Std. 30 Min.")).toBeOnTheScreen();
    expect(screen.getByText("Training (Beispiel)")).toBeOnTheScreen();
    expect(screen.getByText("beginnt in 2 Std. 45 Min.")).toBeOnTheScreen();
    expect(screen.queryByText(/Offline/)).toBeNull();
  });

  it("berechnet den Fortschritt zum Gewerbeziel von 20 Stunden", async () => {
    const result: PlanResult = {
      snapshot: snapshot("2026-10-06T14:55:00.000Z"),
      origin: "network",
    };
    await render(<NowView result={result} now={NOW} />);
    expect(screen.getByText("9 h von 20 h geplant")).toBeOnTheScreen();
    expect(screen.getByText(/5 h erledigt/)).toBeOnTheScreen();
  });

  it("zeigt offline einen deutlichen Hinweis mit Zeitpunkt der letzten Aktualisierung", async () => {
    const result: PlanResult = {
      snapshot: snapshot("2026-10-06T06:00:00.000Z"),
      origin: "cache",
      errorMessage: "Keine Verbindung zum Server.",
    };
    await render(<NowView result={result} now={NOW} />);
    expect(screen.getByText("Offline – gespeicherter Plan")).toBeOnTheScreen();
    expect(screen.getByText(/heute, 08:00 Uhr/)).toBeOnTheScreen();
    // Der gespeicherte Plan wird trotzdem angezeigt.
    expect(screen.getByText("Gewerbe-Block (Beispiel)")).toBeOnTheScreen();
  });

  it("warnt bei veraltetem Plan auch ohne Netzwerkfehler", async () => {
    const result: PlanResult = {
      snapshot: snapshot("2026-10-05T06:00:00.000Z"),
      origin: "network",
    };
    await render(<NowView result={result} now={NOW} />);
    expect(screen.getByText("Plan möglicherweise veraltet")).toBeOnTheScreen();
  });

  it("meldet eine Woche ohne veröffentlichten Plan", async () => {
    const empty = { ...snapshot("2026-10-06T14:55:00.000Z"), weeks: [] };
    await render(<NowView result={{ snapshot: empty, origin: "network" }} now={NOW} />);
    expect(
      screen.getByText("Für diese Woche ist noch kein Plan veröffentlicht."),
    ).toBeOnTheScreen();
    expect(screen.getByText("Kein geplanter Block")).toBeOnTheScreen();
  });
});

describe("LoginView", () => {
  it("bietet keine Registrierung an", async () => {
    await render(<LoginView onSubmit={jest.fn()} />);
    expect(screen.getByLabelText("E-Mail")).toBeOnTheScreen();
    expect(screen.getByLabelText("Passwort")).toBeOnTheScreen();
    expect(screen.queryByRole("button", { name: /Registrier/i })).toBeNull();
    expect(
      screen.getAllByRole("button").map((b) => b.props.accessibilityLabel ?? ""),
    ).not.toContain("Registrieren");
    expect(
      screen.getByText("Privater Zugang. Eine Registrierung ist nicht möglich."),
    ).toBeOnTheScreen();
  });
});
