/**
 * Fokusfläche der Übersicht: Auswahl des Fokusblocks, Vorrang der laufenden Aktivität,
 * unscharfe Nachbarn ohne Bedienelemente, automatischer Wechsel an der Blockgrenze und
 * „Bewegung reduzieren“. Alle Inhalte sind frei erfunden („(Beispiel)“).
 */
import {
  type ActivitySession,
  type CompletionStatus,
  type EntryCategory,
  resolveTimeRange,
} from "@tagestakt/schedule-schema";
import { act, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { FocusStageEntry, FocusStageServerActions } from "./focus-stage";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
  usePathname: () => "/",
}));

const { FocusStage } = await import("./focus-stage");

const DAY = "2026-10-14"; // Mittwoch, Sommerzeit (UTC+2)

function entry(
  id: string,
  title: string,
  category: EntryCategory,
  start: string,
  end: string,
  options: { location?: string; completion?: CompletionStatus; date?: string } = {},
): FocusStageEntry {
  const range = resolveTimeRange(options.date ?? DAY, start, end, false);
  return {
    id,
    title,
    category,
    start_at: range.start.toISOString(),
    end_at: range.end.toISOString(),
    location: options.location ?? null,
    completion_status: options.completion ?? "planned",
  };
}

function session(
  goal: ActivitySession["goal_category"],
  startedAt: string,
  scheduleEntryId: string | null = null,
): ActivitySession {
  return {
    id: "6f1c2d3e-4a5b-4c6d-8e7f-9a0b1c2d3e4f",
    owner_id: "8f14e45f-ceea-4f6a-9d1b-6d2c4f0a9b11",
    schedule_entry_id: scheduleEntryId,
    goal_category: goal,
    title: "Kundenprojekt (Beispiel)",
    started_at: startedAt,
    ended_at: null,
    corrected_at: null,
    created_at: startedAt,
    updated_at: startedAt,
  };
}

const duty = entry("d1", "Dienst (Beispiel)", "duty", "07:00", "16:30");
const business = entry("b1", "Kundenprojekt (Beispiel)", "business", "17:00", "20:00", {
  location: "Arbeitszimmer (Beispiel)",
});
const meal = entry("m1", "Abendessen (Beispiel)", "meal", "20:00", "20:45");
const DAY_PLAN = [duty, business, meal];

const serverAction = vi.fn(async () => ({ status: "idle" as const }));
const actions: FocusStageServerActions = {
  start: serverAction,
  stop: serverAction,
  discard: serverAction,
  switchTo: serverAction,
  setCompletion: serverAction,
};

const FORBIDDEN_WORDS = /einloggen|ausloggen|einstempeln|ausstempeln/i;

function renderAt(
  iso: string,
  props: Partial<{
    entries: FocusStageEntry[];
    running: ActivitySession | null;
    hasPublishedPlan: boolean;
    planError: boolean;
    trackedEntryIds: string[];
  }> = {},
) {
  vi.setSystemTime(new Date(iso));
  return render(
    <FocusStage
      entries={props.entries ?? DAY_PLAN}
      running={props.running ?? null}
      trackedEntryIds={props.trackedEntryIds ?? []}
      hasPublishedPlan={props.hasPublishedPlan ?? true}
      planError={props.planError}
      serverNow={iso}
      actions={actions}
      weekPlanHref="/wochenplan"
    />,
  );
}

function focusHeading() {
  return within(screen.getByTestId("focus-card")).getByRole("heading", { level: 2 });
}

function mockReducedMotion(reduce: boolean) {
  vi.stubGlobal(
    "matchMedia",
    vi.fn((query: string) => ({
      matches: reduce && query.includes("reduce"),
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
}

beforeEach(() => {
  vi.useFakeTimers();
  serverAction.mockClear();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("FocusStage – Auswahl", () => {
  it("zeigt den aktuellen Zielblock groß mit Restzeit, Ort und „Fokus starten“", () => {
    renderAt("2026-10-14T15:30:00Z"); // 17:30
    expect(focusHeading()).toHaveTextContent("Kundenprojekt (Beispiel)");
    const card = screen.getByTestId("focus-card");
    expect(card).toHaveTextContent("Jetzt · 17:00–20:00");
    expect(card).toHaveTextContent("noch 2 Std. 30 Min., endet um 20:00 Uhr");
    expect(card).toHaveTextContent("Ort: Arbeitszimmer (Beispiel)");
    expect(screen.getByText("Noch nicht erfasst.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Fokus starten/ })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "„Kundenprojekt (Beispiel)“ als erledigt markieren" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Kundenprojekt (Beispiel)" })).toHaveAttribute(
      "data-focus",
      "block",
    );
  });

  it("Nachbarblöcke sind unscharf, ohne Bedienelemente und für Screenreader verborgen", () => {
    renderAt("2026-10-14T15:30:00Z");
    for (const id of ["focus-ghost-prev", "focus-ghost-next"]) {
      const ghost = screen.getByTestId(id);
      expect(ghost).toHaveAttribute("aria-hidden", "true");
      expect(ghost).toHaveAttribute("inert");
      expect(ghost.querySelectorAll("a, button, input, textarea, select, [tabindex]")).toHaveLength(
        0,
      );
    }
    expect(screen.getByTestId("focus-ghost-prev")).toHaveTextContent("Dienst (Beispiel)");
    expect(screen.getByTestId("focus-ghost-next")).toHaveTextContent("Abendessen (Beispiel)");
    // Der nächste Block steht zusätzlich als zugänglicher Text im Fokusblock.
    const around = screen.getByRole("list", { name: "Davor und danach" });
    expect(around).toHaveTextContent("Davor: Dienst (Beispiel) bis 16:30");
    expect(around).toHaveTextContent("Danach: 20:00 Abendessen (Beispiel) · in 2 Std. 30 Min.");
  });

  it("anderer Block (Dienst): kein Fokus-Knopf, Status-Aktionen und spontaner Start bleiben", () => {
    renderAt("2026-10-14T10:00:00Z"); // 12:00
    expect(focusHeading()).toHaveTextContent("Dienst (Beispiel)");
    expect(screen.queryByRole("button", { name: /Fokus starten/ })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /als ausgelassen markieren/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Aktivität Sport starten" })).toBeInTheDocument();
    // Vor dem Dienst lag heute nichts.
    expect(screen.queryByTestId("focus-ghost-prev")).not.toBeInTheDocument();
  });

  it("Überschneidung: Hinweis und Fokus auch für den gleichzeitig laufenden Zielblock", () => {
    const sport = entry("s1", "Krafttraining (Beispiel)", "sport", "17:30", "18:30");
    renderAt("2026-10-14T15:45:00Z", { entries: [...DAY_PLAN, sport] }); // 17:45
    expect(focusHeading()).toHaveTextContent("Krafttraining (Beispiel)");
    expect(screen.getByText(/Überschneidung: gleichzeitig/)).toHaveTextContent(
      "„Kundenprojekt (Beispiel)“ (17:00–20:00)",
    );
    expect(screen.getByRole("button", { name: /^Fokus starten/ })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Fokus für „Kundenprojekt \(Beispiel\)“ starten/ }),
    ).toBeInTheDocument();
  });
});

describe("FocusStage – laufende Aktivität", () => {
  it("hat Vorrang vor dem Plan: Timer, Beenden, Zeit korrigieren, Abbrechen und Wechsel", () => {
    const sport = entry("s1", "Krafttraining (Beispiel)", "sport", "17:00", "18:00");
    const running = session("business", "2026-10-14T15:00:00Z", business.id);
    const { container } = renderAt("2026-10-14T15:30:00Z", {
      entries: [...DAY_PLAN, sport],
      running,
    });
    expect(screen.getByRole("region", { name: "Kundenprojekt (Beispiel)" })).toHaveAttribute(
      "data-focus",
      "running",
    );
    expect(screen.getByText("Gewerbe · Läuft")).toBeInTheDocument();
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
    expect(screen.queryByRole("button", { name: /Fokus starten/ })).not.toBeInTheDocument();
    expect(container.textContent ?? "").not.toMatch(FORBIDDEN_WORDS);
  });

  it("über 24 Stunden: Beenden nur über „Zeit korrigieren“", () => {
    const old = session("sport", "2026-10-13T10:00:00Z");
    renderAt("2026-10-14T15:30:00Z", { running: old });
    expect(screen.queryByRole("button", { name: /^Beenden/ })).not.toBeInTheDocument();
    expect(screen.getByText(/Vermutlich vergessen/)).toBeInTheDocument();
  });
});

describe("FocusStage – freie Zeit und Randzustände", () => {
  it("freie Zeit: Überschrift, nächster Block mit Countdown, nichts startet automatisch", () => {
    renderAt("2026-10-14T14:40:00Z"); // 16:40
    expect(focusHeading()).toHaveTextContent("Freie Zeit");
    const card = screen.getByTestId("focus-card");
    expect(card).toHaveTextContent("noch 20 Min. bis zum nächsten Block");
    expect(card).toHaveTextContent("Als Nächstes: 17:00 Kundenprojekt (Beispiel)");
    expect(screen.getByRole("button", { name: "Aktivität Gewerbe starten" })).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(5 * 60_000);
    });
    expect(serverAction).not.toHaveBeenCalled();
  });

  it("vor dem ersten Block", () => {
    renderAt("2026-10-14T04:00:00Z"); // 06:00
    expect(focusHeading()).toHaveTextContent("Noch frei bis 07:00");
    expect(screen.getByTestId("focus-card")).toHaveTextContent("1 Std. bis zum ersten Block");
  });

  it("nach dem letzten Block", () => {
    renderAt("2026-10-14T19:00:00Z"); // 21:00
    expect(focusHeading()).toHaveTextContent("Heute ist nichts mehr geplant.");
    expect(screen.getByTestId("focus-ghost-prev")).toHaveTextContent("Abendessen (Beispiel)");
    expect(screen.queryByTestId("focus-ghost-next")).not.toBeInTheDocument();
  });

  it("kein veröffentlichter Plan: Weg zum Wochenplan, Erfassen bleibt möglich", () => {
    renderAt("2026-10-14T15:30:00Z", { entries: [], hasPublishedPlan: false });
    expect(focusHeading()).toHaveTextContent("Für diese Woche ist kein Plan veröffentlicht.");
    expect(screen.getByRole("link", { name: "Zum Wochenplan" })).toHaveAttribute(
      "href",
      "/wochenplan",
    );
    expect(screen.getByRole("button", { name: "Aktivität Laila starten" })).toBeInTheDocument();
    expect(screen.queryByTestId("focus-ghost-prev")).not.toBeInTheDocument();
  });

  it("Fehler beim Laden: verständlicher Hinweis mit Fehlercode, ohne interne Details", () => {
    renderAt("2026-10-14T15:30:00Z", { entries: [], planError: true });
    expect(focusHeading()).toHaveTextContent("Der Plan konnte nicht geladen werden.");
    expect(screen.getByRole("button", { name: "Erneut versuchen" })).toBeInTheDocument();
    expect(screen.getByText("Fehlercode: PLAN_LOAD")).toBeInTheDocument();
  });
});

describe("FocusStage – Wechsel an der Blockgrenze", () => {
  it("wechselt zur Startzeit ohne Neuladen und ohne sekündliche Neuberechnung", () => {
    renderAt("2026-10-14T14:59:30Z"); // 16:59:30, freie Zeit
    act(() => {
      vi.advanceTimersByTime(0);
    });
    expect(focusHeading()).toHaveTextContent("Freie Zeit");
    expect(screen.getByTestId("focus-card")).not.toHaveClass("focus-card--enter");
    // Nur der Grenz-Timer und der Minutentakt – kein Sekunden-Intervall.
    expect(vi.getTimerCount()).toBe(2);

    act(() => {
      vi.advanceTimersByTime(29_000);
    });
    expect(focusHeading()).toHaveTextContent("Freie Zeit");

    act(() => {
      vi.advanceTimersByTime(1_100);
    });
    expect(focusHeading()).toHaveTextContent("Kundenprojekt (Beispiel)");
    expect(screen.getByTestId("focus-card")).toHaveClass("focus-card--enter");
    expect(screen.getByText("Jetzt im Fokus: Kundenprojekt (Beispiel)")).toBeInTheDocument();
  });

  it("wechselt zur Endzeit in die freie Zeit bzw. nach dem letzten Block", () => {
    renderAt("2026-10-14T18:44:00Z"); // 20:44, Abendessen
    expect(focusHeading()).toHaveTextContent("Abendessen (Beispiel)");
    act(() => {
      vi.advanceTimersByTime(60_100);
    });
    expect(focusHeading()).toHaveTextContent("Heute ist nichts mehr geplant.");
  });

  it("„Bewegung reduzieren“: Wechsel ohne Einblende- oder Bewegungseffekt", () => {
    mockReducedMotion(true);
    renderAt("2026-10-14T14:59:30Z");
    expect(screen.getByRole("region", { name: "Freie Zeit" })).toHaveAttribute(
      "data-motion",
      "reduced",
    );
    act(() => {
      vi.advanceTimersByTime(30_100);
    });
    expect(focusHeading()).toHaveTextContent("Kundenprojekt (Beispiel)");
    expect(screen.getByTestId("focus-card")).not.toHaveClass("focus-card--enter");
  });
});
