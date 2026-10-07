import { type ScheduleEntry, detectOverlaps, resolveTimeRange } from "@tagestakt/schedule-schema";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { type ActionState } from "@/lib/form";

import { EntryForm } from "./entry-form";
import { LoginForm } from "./login-form";
import { OverlapWarning } from "./overlap-warning";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
  usePathname: () => "/",
}));

function entry(id: string, title: string, date: string, start: string, end: string): ScheduleEntry {
  const range = resolveTimeRange(date, start, end, false);
  return {
    id,
    owner_id: "8f14e45f-ceea-4f6a-9d1b-6d2c4f0a9b11",
    schedule_week_id: "c9f0f895-fb98-4b91-9f5a-1c2d3e4f5a6b",
    title,
    category: "duty",
    start_at: range.start.toISOString(),
    end_at: range.end.toISOString(),
    location: null,
    note: null,
    source: "manual",
    completion_status: "planned",
    created_at: "2026-10-01T00:00:00+00:00",
    updated_at: "2026-10-01T00:00:00+00:00",
  };
}

describe("LoginForm", () => {
  it("zeigt E-Mail und Passwort, aber keine Registrierung", () => {
    render(<LoginForm action={vi.fn()} />);
    expect(screen.getByLabelText("E-Mail")).toHaveAttribute("type", "email");
    expect(screen.getByLabelText("Passwort")).toHaveAttribute("type", "password");
    expect(screen.getByRole("button", { name: "Anmelden" })).toBeInTheDocument();
    expect(screen.queryByText(/registrier/i)).not.toBeInTheDocument();
  });

  it("zeigt die Fehlermeldung der Server Action an", async () => {
    const action = vi.fn(async (): Promise<ActionState> => ({
      status: "error",
      message: "E-Mail oder Passwort ist falsch.",
      values: { email: "demo@tagestakt.test" },
    }));
    render(<LoginForm action={action} />);
    await userEvent.type(screen.getByLabelText("E-Mail"), "demo@tagestakt.test");
    await userEvent.type(screen.getByLabelText("Passwort"), "falsch");
    await userEvent.click(screen.getByRole("button", { name: "Anmelden" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("E-Mail oder Passwort ist falsch.");
    expect(action).toHaveBeenCalledOnce();
  });
});

describe("EntryForm", () => {
  const days = [
    { value: "2026-10-05", label: "Montag, 5. Oktober" },
    { value: "2026-10-06", label: "Dienstag, 6. Oktober" },
  ];
  const defaults = {
    title: "",
    category: "business",
    date: "2026-10-05",
    startTime: "09:00",
    endTime: "10:00",
    endsNextDay: false,
    location: "",
    note: "",
  };

  it("bietet alle Felder eines Eintrags an", () => {
    render(
      <EntryForm
        action={vi.fn()}
        days={days}
        defaults={defaults}
        idPrefix="t"
        submitLabel="Speichern"
      />,
    );
    for (const label of [
      "Titel",
      "Kategorie",
      "Tag",
      "Beginn",
      "Ende",
      "Ort (optional)",
      "Notiz (optional)",
    ]) {
      expect(screen.getByLabelText(label)).toBeInTheDocument();
    }
    expect(screen.getByLabelText("Endet am Folgetag")).not.toBeChecked();
    expect(screen.getByRole("option", { name: "Gewerbe" })).toBeInTheDocument();
  });

  it("markiert fehlerhafte Felder und behält die Eingaben", async () => {
    const action = vi.fn(async (): Promise<ActionState> => ({
      status: "error",
      message: "Bitte die markierten Felder prüfen.",
      fieldErrors: { endTime: ["Die Endzeit muss nach der Startzeit liegen"] },
      values: { ...defaults, title: "Beispiel", endTime: "08:00", endsNextDay: "" },
    }));
    render(
      <EntryForm
        action={action}
        days={days}
        defaults={defaults}
        idPrefix="t"
        submitLabel="Speichern"
      />,
    );
    await userEvent.type(screen.getByLabelText("Titel"), "Beispiel");
    await userEvent.click(screen.getByRole("button", { name: "Speichern" }));
    await waitFor(() =>
      expect(screen.getByText("Die Endzeit muss nach der Startzeit liegen")).toBeInTheDocument(),
    );
    expect(screen.getByLabelText("Ende")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByLabelText("Titel")).toHaveValue("Beispiel");
  });
});

describe("OverlapWarning", () => {
  it("beschreibt Überschneidungen verständlich", () => {
    const overlaps = detectOverlaps([
      entry("a", "Dienst", "2026-10-07", "08:00", "14:00"),
      entry("b", "Beispieltermin", "2026-10-07", "12:00", "12:30"),
    ]);
    render(<OverlapWarning overlaps={overlaps} />);
    expect(screen.getByRole("heading", { name: "1 Zeitüberschneidung" })).toBeInTheDocument();
    expect(
      screen.getByText(/„Dienst“ \(Mi 07\.10\. 08:00–14:00\) und „Beispieltermin“/),
    ).toHaveTextContent("überschneiden sich (30 Min. gemeinsam).");
  });

  it("rendert nichts ohne Überschneidungen", () => {
    const { container } = render(<OverlapWarning overlaps={[]} />);
    expect(container).toBeEmptyDOMElement();
  });
});
