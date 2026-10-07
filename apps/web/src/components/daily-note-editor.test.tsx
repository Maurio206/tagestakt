/**
 * Tagesnotiz-Editor: Zustände leer → geändert → speichert → gespeichert, Fehler mit erneutem
 * Speichern, Konflikt und Eingaben während des Speicherns. Inhalte sind frei erfunden.
 */
import type { DailyNoteSaveInput, DailyNoteSnapshot } from "@tagestakt/schedule-schema";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { DailyNoteActionResult, SaveDailyNote } from "@/lib/daily-note";

import { DailyNoteEditor } from "./daily-note-editor";
import { DayNotes } from "./day-notes";
import { TodayNote } from "./today-note";

const NOTE_ID = "6f9619ff-8b86-4d01-b42d-00c04fc964ff";
const DATE = "2026-10-14";
const LABEL = "Mittwoch, 14. Oktober";

function snapshot(content: string, revision = 1): DailyNoteSnapshot {
  return { id: NOTE_ID, revision, content, updatedAt: "2026-10-14T06:12:00.000Z" };
}

/** Speicherfunktion, deren Antwort der Test selbst auslöst. */
function deferredSave() {
  const calls: { input: DailyNoteSaveInput; resolve: (r: DailyNoteActionResult) => void }[] = [];
  const save = vi.fn(
    (input: DailyNoteSaveInput) =>
      new Promise<DailyNoteActionResult>((resolve) => {
        calls.push({ input, resolve });
      }),
  );
  return { save, calls };
}

function renderEditor(initialNote: DailyNoteSnapshot | null, save: SaveDailyNote) {
  return render(
    <DailyNoteEditor date={DATE} dateLabel={LABEL} initialNote={initialNote} save={save} />,
  );
}

function textarea() {
  return screen.getByRole("textbox", { name: `Tagesnotiz für ${LABEL}` });
}

describe("DailyNoteEditor", () => {
  it("leer → geändert → speichert → gespeichert mit Uhrzeit", async () => {
    const user = userEvent.setup();
    const { save, calls } = deferredSave();
    renderEditor(null, save);
    expect(screen.getByRole("status")).toHaveTextContent("Noch keine Notiz für diesen Tag.");
    expect(screen.getByRole("button", { name: "Speichern" })).toBeDisabled();

    await user.type(textarea(), "Material bereitlegen (Beispiel){Enter}Zweite Zeile");
    expect(screen.getByRole("status")).toHaveTextContent("Nicht gespeicherte Änderungen");

    await user.click(screen.getByRole("button", { name: "Speichern" }));
    expect(screen.getByRole("status")).toHaveTextContent("Wird gespeichert …");
    expect(screen.getByRole("button", { name: "Wird gespeichert …" })).toBeDisabled();
    expect(calls[0]?.input).toEqual({
      date: DATE,
      content: "Material bereitlegen (Beispiel)\nZweite Zeile",
      expected: null,
    });

    await act(async () => {
      calls[0]?.resolve({
        status: "saved",
        note: snapshot("Material bereitlegen (Beispiel)\nZweite Zeile"),
        at: "2026-10-14T06:12:00.000Z",
      });
    });
    expect(screen.getByRole("status")).toHaveTextContent("Gespeichert um 08:12 Uhr");
    expect(textarea()).toHaveValue("Material bereitlegen (Beispiel)\nZweite Zeile");
  });

  it("Fehler: Text bleibt, Meldung ohne Inhalt, „Erneut speichern“ funktioniert", async () => {
    const user = userEvent.setup();
    const { save, calls } = deferredSave();
    renderEditor(null, save);
    await user.type(textarea(), "Notiz (Beispiel)");
    await user.click(screen.getByRole("button", { name: "Speichern" }));
    await act(async () => {
      calls[0]?.resolve({ status: "error", message: "Nicht gespeichert. Bitte erneut versuchen." });
    });
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("Nicht gespeichert. Bitte erneut versuchen.");
    expect(alert).not.toHaveTextContent("Notiz (Beispiel)");
    expect(textarea()).toHaveValue("Notiz (Beispiel)");
    expect(textarea()).toHaveAttribute("aria-invalid", "true");

    await user.click(screen.getByRole("button", { name: "Erneut speichern" }));
    await act(async () => {
      calls[1]?.resolve({
        status: "saved",
        note: snapshot("Notiz (Beispiel)"),
        at: "2026-10-14T06:12:00.000Z",
      });
    });
    expect(screen.getByRole("status")).toHaveTextContent("Gespeichert um 08:12 Uhr");
  });

  it("ohne Verbindung (Netzwerkfehler): Text bleibt und Hinweis erscheint", async () => {
    const user = userEvent.setup();
    const save = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    });
    renderEditor(null, save);
    await user.type(textarea(), "Unterwegs (Beispiel)");
    await user.click(screen.getByRole("button", { name: "Speichern" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Keine Verbindung.");
    expect(textarea()).toHaveValue("Unterwegs (Beispiel)");
  });

  it("Eingaben während des Speicherns bleiben erhalten", async () => {
    const user = userEvent.setup();
    const { save, calls } = deferredSave();
    renderEditor(null, save);
    await user.type(textarea(), "Erster Teil");
    await user.click(screen.getByRole("button", { name: "Speichern" }));
    await user.type(textarea(), " und mehr");
    await act(async () => {
      calls[0]?.resolve({
        status: "saved",
        note: snapshot("Erster Teil"),
        at: "2026-10-14T06:12:00.000Z",
      });
    });
    expect(textarea()).toHaveValue("Erster Teil und mehr");
    expect(screen.getByRole("status")).toHaveTextContent("Nicht gespeicherte Änderungen");
  });

  it("Konflikt: eigene Fassung bleibt; speichern mit neuem Stand oder gespeicherte laden", async () => {
    const user = userEvent.setup();
    const { save, calls } = deferredSave();
    renderEditor(snapshot("Alt (Beispiel)"), save);
    await user.clear(textarea());
    await user.type(textarea(), "Meine Fassung (Beispiel)");
    await user.click(screen.getByRole("button", { name: "Speichern" }));
    expect(calls[0]?.input.expected).toEqual({ id: NOTE_ID, revision: 1 });
    await act(async () => {
      calls[0]?.resolve({ status: "conflict", latest: snapshot("Andere Fassung (Beispiel)", 3) });
    });
    expect(screen.getByRole("alert")).toHaveTextContent("inzwischen an anderer Stelle geändert");
    expect(textarea()).toHaveValue("Meine Fassung (Beispiel)");
    // Die andere Fassung ist sichtbar, bevor der Benutzer entscheidet.
    expect(screen.getByRole("region", { name: "Andere gespeicherte Fassung:" })).toHaveTextContent(
      "Andere Fassung (Beispiel)",
    );

    await user.click(screen.getByRole("button", { name: "Meine Fassung speichern" }));
    expect(calls[1]?.input).toEqual({
      date: DATE,
      content: "Meine Fassung (Beispiel)",
      expected: { id: NOTE_ID, revision: 3 },
    });
    await act(async () => {
      calls[1]?.resolve({ status: "conflict", latest: snapshot("Noch neuer (Beispiel)", 4) });
    });
    await user.click(screen.getByRole("button", { name: "Gespeicherte Fassung laden" }));
    expect(textarea()).toHaveValue("Noch neuer (Beispiel)");
  });

  it("Strg + S speichert per Tastatur", async () => {
    const user = userEvent.setup();
    const { save } = deferredSave();
    renderEditor(null, save);
    await user.type(textarea(), "Kurz (Beispiel)");
    await user.keyboard("{Control>}s{/Control}");
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("zu lange Notiz: Zähler und Meldung, Speichern gesperrt", async () => {
    const { save } = deferredSave();
    renderEditor(snapshot("x"), save);
    await act(async () => {
      const field = textarea() as HTMLTextAreaElement;
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
      setter?.call(field, "a".repeat(10_001));
      field.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(screen.getByRole("alert")).toHaveTextContent("Die Notiz ist zu lang");
    expect(screen.getByText(/10\.001/)).toHaveClass("note-count--over");
    expect(screen.getByRole("button", { name: "Speichern" })).toBeDisabled();
  });
});

describe("TodayNote", () => {
  it("zeigt kompakt die erste Zeile und klappt zum Editor auf", async () => {
    const user = userEvent.setup();
    const { save } = deferredSave();
    render(
      <TodayNote
        date={DATE}
        dateLabel={LABEL}
        note={snapshot("Material bereitlegen (Beispiel)\nZweite Zeile")}
        save={save}
      />,
    );
    const summary = screen.getByText("Tagesnotiz · heute").closest("summary");
    expect(summary).toHaveTextContent("Material bereitlegen (Beispiel)");
    expect(summary).not.toHaveTextContent("Zweite Zeile");
    if (!summary) throw new Error("summary fehlt");
    await user.click(summary);
    expect(textarea()).toBeVisible();
  });

  it("Ladefehler: kein Editor, keine erfundene Notiz", () => {
    const { save } = deferredSave();
    render(<TodayNote date={DATE} dateLabel={LABEL} note={null} loadError save={save} />);
    expect(screen.getByText("Tagesnotiz konnte nicht geladen werden.")).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { hidden: true })).not.toBeInTheDocument();
  });

  it("Tageswechsel um Mitternacht: ungespeicherter Text bleibt beim bisherigen Tag", async () => {
    const user = userEvent.setup();
    const { save, calls } = deferredSave();
    const { rerender } = render(
      <TodayNote date={DATE} dateLabel={LABEL} note={null} save={save} />,
    );
    await user.click(screen.getByText("Tagesnotiz · heute"));
    await user.type(textarea(), "Noch von gestern (Beispiel)");

    // Automatisches Aktualisieren nach Mitternacht liefert den neuen Tag.
    const NEXT = "2026-10-15";
    const NEXT_LABEL = "Donnerstag, 15. Oktober";
    rerender(
      <TodayNote
        date={NEXT}
        dateLabel={NEXT_LABEL}
        note={snapshot("Neuer Tag (Beispiel)")}
        save={save}
      />,
    );
    expect(textarea()).toHaveValue("Noch von gestern (Beispiel)");
    expect(screen.getByText(`Tagesnotiz · ${LABEL}`)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Speichern" }));
    expect(calls[0]?.input).toMatchObject({ date: DATE, content: "Noch von gestern (Beispiel)" });
    await act(async () => {
      calls[0]?.resolve({
        status: "saved",
        note: snapshot("Noch von gestern (Beispiel)"),
        at: "2026-10-14T21:59:00.000Z",
      });
    });
    // Erst ohne offene Änderungen folgt der Editor dem neuen Tag.
    expect(screen.getByText("Tagesnotiz · heute")).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: `Tagesnotiz für ${NEXT_LABEL}` })).toHaveValue(
      "Neuer Tag (Beispiel)",
    );
  });
});

describe("Schutz vor ungespeichertem Verlassen", () => {
  it("fragt vor Links nach, solange Änderungen ungespeichert sind", async () => {
    const user = userEvent.setup();
    const { save } = deferredSave();
    render(
      <>
        <a href="/auswertung">Auswertung</a>
        <DailyNoteEditor date={DATE} dateLabel={LABEL} initialNote={null} save={save} />
      </>,
    );
    const link = screen.getByRole("link", { name: "Auswertung" });
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    // Ohne Änderungen: keine Rückfrage.
    link.addEventListener("click", (event) => event.preventDefault(), { once: true });
    fireEvent.click(link);
    expect(confirm).not.toHaveBeenCalled();

    await user.type(textarea(), "Ungespeichert (Beispiel)");
    expect(fireEvent.click(link)).toBe(false);
    expect(confirm).toHaveBeenCalledWith(
      "Die Tagesnotiz ist noch nicht gespeichert. Trotzdem wechseln?",
    );
    expect(textarea()).toHaveValue("Ungespeichert (Beispiel)");
    confirm.mockRestore();
  });

  it("fragt auch vor dem Absenden anderer Formulare (z. B. Plan bearbeiten) nach", async () => {
    const user = userEvent.setup();
    const { save } = deferredSave();
    const onSubmit = vi.fn((event: React.FormEvent) => event.preventDefault());
    render(
      <>
        <form aria-label="Plan" onSubmit={onSubmit}>
          <button type="submit">Eintrag hinzufügen</button>
        </form>
        <DailyNoteEditor date={DATE} dateLabel={LABEL} initialNote={null} save={save} />
      </>,
    );
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    await user.type(textarea(), "Ungespeichert (Beispiel)");
    await user.click(screen.getByRole("button", { name: "Eintrag hinzufügen" }));
    expect(confirm).toHaveBeenCalled();
    expect(onSubmit).not.toHaveBeenCalled();

    confirm.mockReturnValue(true);
    await user.click(screen.getByRole("button", { name: "Eintrag hinzufügen" }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
    confirm.mockRestore();
  });
});

describe("DayNotes", () => {
  const days = [
    "2026-10-12",
    "2026-10-13",
    "2026-10-14",
    "2026-10-15",
    "2026-10-16",
    "2026-10-17",
    "2026-10-18",
  ];

  it("Tagesauswahl als Links mit Markierung, genau ein Editor für den gewählten Tag", () => {
    const { save } = deferredSave();
    render(
      <DayNotes
        days={days}
        selected="2026-10-14"
        today="2026-10-14"
        noteDates={new Set(["2026-10-14", "2026-10-16"])}
        note={snapshot("Material bereitlegen (Beispiel)")}
        dayHref={(date) => `/wochenplan?woche=2026-10-12&notiz=${date}#tagesnotiz`}
        save={save}
      />,
    );
    const nav = screen.getByRole("navigation", { name: "Tag für die Notiz wählen" });
    const links = within(nav).getAllByRole("link");
    expect(links).toHaveLength(7);
    const selected = within(nav).getByRole("link", {
      name: "Mittwoch, 14. Oktober (heute), Notiz vorhanden",
    });
    expect(selected).toHaveAttribute("aria-current", "date");
    expect(selected).toHaveAttribute(
      "href",
      "/wochenplan?woche=2026-10-12&notiz=2026-10-14#tagesnotiz",
    );
    expect(
      within(nav).getByRole("link", { name: "Freitag, 16. Oktober, Notiz vorhanden" }),
    ).toBeInTheDocument();
    expect(within(nav).getByRole("link", { name: "Montag, 12. Oktober" })).not.toHaveAttribute(
      "aria-current",
    );
    expect(screen.getAllByRole("textbox")).toHaveLength(1);
    expect(textarea()).toHaveValue("Material bereitlegen (Beispiel)");
  });

  it("Ladefehler: Hinweis statt Editor, keine erfundene Notiz", () => {
    const { save } = deferredSave();
    render(
      <DayNotes
        days={days}
        selected="2026-10-13"
        today="2026-10-14"
        noteDates={new Set()}
        note={null}
        loadError
        dayHref={(date) => `/wochenplan?notiz=${date}`}
        save={save}
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("konnte nicht geladen werden");
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });
});
