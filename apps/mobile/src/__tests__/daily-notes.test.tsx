/**
 * Tagesnotiz in der App: Editor (Speichern, Fehler, Konflikt, Eingaben während des
 * Speicherns), Tastatur, Offline-Verhalten und Datenschutz (kein Gerätespeicher, keine
 * Benachrichtigungen). Alle Inhalte sind frei erfunden („(Beispiel)“).
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import type {
  DailyNoteSaveInput,
  DailyNoteSaveResult,
  DailyNoteSnapshot,
} from "@tagestakt/schedule-schema";
import { act, fireEvent, render, renderHook, screen } from "@testing-library/react-native";
import { Keyboard, StyleSheet } from "react-native";

import { DayNoteCard } from "@/components/note-card";
import { NoteEditor } from "@/components/note-editor";
import type { DailyNoteState } from "@/hooks/use-daily-note";
import { useKeyboardInset } from "@/hooks/use-keyboard-inset";
import { NoteLoadError, fetchDailyNote, saveDailyNote } from "@/lib/daily-notes-api";
import type { TypedSupabaseClient } from "@/lib/supabase";

jest.mock(
  "react-native-safe-area-context",
  () =>
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require("react-native-safe-area-context/jest/mock").default,
);

const mockNoteState: { current: DailyNoteState } = { current: { status: "ready", note: null } };
jest.mock("@/hooks/use-daily-note", () => ({
  useDailyNote: () => ({
    state: mockNoteState.current,
    save: jest.fn(),
    refetch: jest.fn(),
    isFetching: false,
  }),
}));
jest.mock("expo-router", () => ({
  useLocalSearchParams: () => ({ date: "2026-10-06" }),
  useRouter: () => ({ back: jest.fn(), canGoBack: () => true, replace: jest.fn() }),
}));

const NOTE_ID = "6f9619ff-8b86-4d01-b42d-00c04fc964ff";
const DATE = "2026-10-06";
const LABEL = "Dienstag, 6. Oktober";

function snapshot(content: string, revision = 1): DailyNoteSnapshot {
  return { id: NOTE_ID, revision, content, updatedAt: "2026-10-06T06:12:00.000Z" };
}

function row(content: string, revision = 1) {
  return {
    id: NOTE_ID,
    owner_id: "8f14e45f-ceea-4f6a-9d1b-6d2c4f0a9b11",
    note_date: DATE,
    content,
    revision,
    created_at: "2026-10-06T06:00:00+00:00",
    updated_at: "2026-10-06T06:12:00+00:00",
  };
}

/** Speicherfunktion, deren Antworten der Test auslöst. */
function deferredSave() {
  const calls: { input: DailyNoteSaveInput; resolve: (r: DailyNoteSaveResult) => void }[] = [];
  const save = jest.fn(
    (input: DailyNoteSaveInput) =>
      new Promise<DailyNoteSaveResult>((resolve) => {
        calls.push({ input, resolve });
      }),
  );
  return { save, calls };
}

function input() {
  return screen.getByLabelText(`Tagesnotiz für ${LABEL}`);
}

describe("NoteEditor (App)", () => {
  it("leer → geändert → speichert → gespeichert; Zeilenumbrüche bleiben", async () => {
    const { save, calls } = deferredSave();
    await render(<NoteEditor date={DATE} dateLabel={LABEL} initialNote={null} save={save} />);
    expect(screen.getByText("Noch keine Notiz für diesen Tag.")).toBeOnTheScreen();
    expect(screen.getByRole("button", { name: "Speichern" })).toBeDisabled();

    await fireEvent.changeText(input(), "Material bereitlegen (Beispiel)\r\nZweite Zeile ");
    expect(screen.getByText("Nicht gespeicherte Änderungen")).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole("button", { name: "Speichern" }));
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
        at: "2026-10-06T06:12:00.000Z",
      });
    });
    expect(screen.getByText("Gespeichert um 08:12 Uhr")).toBeOnTheScreen();
  });

  it("Fehler: Text bleibt erhalten, „Erneut speichern“", async () => {
    const { save, calls } = deferredSave();
    await render(<NoteEditor date={DATE} dateLabel={LABEL} initialNote={null} save={save} />);
    await fireEvent.changeText(input(), "Notiz (Beispiel)");
    await fireEvent.press(screen.getByRole("button", { name: "Speichern" }));
    await act(async () => {
      calls[0]?.resolve({ status: "error", message: "Nicht gespeichert. Bitte erneut versuchen." });
    });
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Nicht gespeichert. Bitte erneut versuchen.",
    );
    expect(input().props.value).toBe("Notiz (Beispiel)");
    await fireEvent.press(screen.getByRole("button", { name: "Erneut speichern" }));
    expect(save).toHaveBeenCalledTimes(2);
  });

  it("Eingaben während des Speicherns gehen nicht verloren", async () => {
    const { save, calls } = deferredSave();
    await render(<NoteEditor date={DATE} dateLabel={LABEL} initialNote={null} save={save} />);
    await fireEvent.changeText(input(), "Erster Teil");
    await fireEvent.press(screen.getByRole("button", { name: "Speichern" }));
    await fireEvent.changeText(input(), "Erster Teil und mehr");
    await act(async () => {
      calls[0]?.resolve({
        status: "saved",
        note: snapshot("Erster Teil"),
        at: "2026-10-06T06:12:00.000Z",
      });
    });
    expect(input().props.value).toBe("Erster Teil und mehr");
    expect(screen.getByText("Nicht gespeicherte Änderungen")).toBeOnTheScreen();
  });

  it("Konflikt: eigene Fassung bleibt; Benutzer entscheidet", async () => {
    const { save, calls } = deferredSave();
    await render(
      <NoteEditor
        date={DATE}
        dateLabel={LABEL}
        initialNote={snapshot("Alt (Beispiel)")}
        save={save}
      />,
    );
    await fireEvent.changeText(input(), "Meine Fassung (Beispiel)");
    await fireEvent.press(screen.getByRole("button", { name: "Speichern" }));
    await act(async () => {
      calls[0]?.resolve({ status: "conflict", latest: snapshot("Andere (Beispiel)", 3) });
    });
    expect(screen.getByRole("alert")).toHaveTextContent(/an anderer Stelle geändert/);
    expect(input().props.value).toBe("Meine Fassung (Beispiel)");
    // Die andere Fassung ist sichtbar, bevor entschieden wird.
    expect(screen.getByText("Andere gespeicherte Fassung:")).toBeOnTheScreen();
    expect(screen.getByTestId("note-conflict")).toHaveTextContent("Andere (Beispiel)");
    await fireEvent.press(screen.getByRole("button", { name: "Meine Fassung speichern" }));
    expect(calls[1]?.input.expected).toEqual({ id: NOTE_ID, revision: 3 });
  });

  it("speichert nichts auf dem Gerät (kein AsyncStorage, kein Plan-Cache)", async () => {
    const setItem = jest.spyOn(AsyncStorage, "setItem");
    const multiSet = jest.spyOn(AsyncStorage, "multiSet");
    const { save, calls } = deferredSave();
    await render(<NoteEditor date={DATE} dateLabel={LABEL} initialNote={null} save={save} />);
    await fireEvent.changeText(input(), "Geheimer Inhalt (Beispiel)");
    await fireEvent.press(screen.getByRole("button", { name: "Speichern" }));
    await act(async () => {
      calls[0]?.resolve({
        status: "saved",
        note: snapshot("Geheimer Inhalt (Beispiel)"),
        at: "2026-10-06T06:12:00.000Z",
      });
    });
    expect(setItem).not.toHaveBeenCalled();
    expect(multiSet).not.toHaveBeenCalled();
    const keys = await AsyncStorage.getAllKeys();
    const values = await AsyncStorage.multiGet(keys);
    expect(JSON.stringify(values)).not.toContain("Geheimer Inhalt");
  });
});

describe("Tagesnotiz-API (App)", () => {
  function fakeClient(options: {
    rpc?: jest.Mock;
    select?: { data: unknown; error: unknown } | Error;
  }): TypedSupabaseClient {
    const maybeSingle = jest.fn(async () => {
      if (options.select instanceof Error) throw options.select;
      return options.select ?? { data: null, error: null };
    });
    const builder = { select: () => builder, eq: () => builder, maybeSingle };
    return {
      rpc: options.rpc ?? jest.fn(),
      from: jest.fn(() => builder),
    } as unknown as TypedSupabaseClient;
  }

  it("speichert über die RPC und liefert den neuen Stand", async () => {
    const rpc = jest.fn(async () => ({ data: [row("Notiz (Beispiel)", 2)], error: null }));
    const result = await saveDailyNote(fakeClient({ rpc }), {
      date: DATE,
      content: "  Notiz (Beispiel)  ",
      expected: { id: NOTE_ID, revision: 1 },
    });
    expect(rpc).toHaveBeenCalledWith("save_daily_note", {
      p_note_date: DATE,
      p_content: "Notiz (Beispiel)",
      p_expected_id: NOTE_ID,
      p_expected_revision: 1,
    });
    expect(result).toMatchObject({ status: "saved", note: { revision: 2 } });
  });

  it("TT007 wird zum Konflikt mit aktuellem Stand – nie still überschrieben", async () => {
    const rpc = jest.fn(async () => ({
      data: null,
      error: { code: "TT007", message: "Die Notiz wurde inzwischen an anderer Stelle geändert." },
    }));
    const client = fakeClient({ rpc, select: { data: row("Neuer (Beispiel)", 4), error: null } });
    const result = await saveDailyNote(client, { date: DATE, content: "x", expected: null });
    expect(result).toMatchObject({
      status: "conflict",
      latest: { id: NOTE_ID, revision: 4, content: "Neuer (Beispiel)" },
    });
  });

  it("TT007, aber der aktuelle Stand lässt sich nicht laden: Fehler statt „gelöscht“", async () => {
    const rpc = jest.fn(async () => ({
      data: null,
      error: { code: "TT007", message: "Die Notiz wurde inzwischen an anderer Stelle geändert." },
    }));
    const client = fakeClient({ rpc, select: new TypeError("Network request failed") });
    const result = await saveDailyNote(client, {
      date: DATE,
      content: "x",
      expected: { id: NOTE_ID, revision: 1 },
    });
    expect(result.status).toBe("error");
    expect(result).not.toHaveProperty("latest");
  });

  it("ohne Verbindung: verständliche Meldung, nichts wird vorgetäuscht", async () => {
    const rpc = jest.fn(async () => {
      throw new TypeError("Network request failed");
    });
    expect(
      await saveDailyNote(fakeClient({ rpc }), { date: DATE, content: "x", expected: null }),
    ).toEqual({
      status: "error",
      message: "Keine Verbindung. Dein Text bleibt hier erhalten – bitte später erneut speichern.",
    });
    await expect(
      fetchDailyNote(fakeClient({ select: new TypeError("Network request failed") }), DATE),
    ).rejects.toEqual(new NoteLoadError("offline"));
  });

  it("prüft Datum und Länge vor dem Senden", async () => {
    const rpc = jest.fn();
    const client = fakeClient({ rpc });
    expect(
      await saveDailyNote(client, { date: "2026-02-30", content: "x", expected: null }),
    ).toEqual({ status: "error", message: "Ungültige Anfrage." });
    expect(
      await saveDailyNote(client, { date: DATE, content: "a".repeat(10_001), expected: null }),
    ).toEqual({ status: "error", message: "Die Notiz ist zu lang (höchstens 10 000 Zeichen)." });
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe("Tagesansicht und Tastatur", () => {
  it("offline: Hinweis statt Notiz, keine vorgetäuschten Inhalte", async () => {
    const onRetry = jest.fn();
    await render(
      <DayNoteCard
        state={{ status: "ready", note: snapshot("Sollte nicht erscheinen (Beispiel)") }}
        offline
        onOpen={jest.fn()}
        onRetry={onRetry}
      />,
    );
    expect(screen.getByText("Ohne Verbindung nicht verfügbar")).toBeOnTheScreen();
    expect(screen.queryByText(/Sollte nicht erscheinen/)).toBeNull();
    await fireEvent.press(screen.getByRole("button", { name: "Erneut versuchen" }));
    expect(onRetry).toHaveBeenCalled();
  });

  it("online: Vorschau und „Notiz bearbeiten“", async () => {
    const onOpen = jest.fn();
    await render(
      <DayNoteCard
        state={{ status: "ready", note: snapshot("Material bereitlegen (Beispiel)") }}
        offline={false}
        onOpen={onOpen}
        onRetry={jest.fn()}
      />,
    );
    expect(screen.getByText("Material bereitlegen (Beispiel)")).toBeOnTheScreen();
    expect(screen.getByText("Gespeichert 08:12")).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole("button", { name: "Notiz bearbeiten" }));
    expect(onOpen).toHaveBeenCalled();
  });

  function captureKeyboard() {
    const handlers: Record<string, (event: { endCoordinates: { height: number } }) => void> = {};
    jest.spyOn(Keyboard, "addListener").mockImplementation(((
      event: string,
      handler: (event: { endCoordinates: { height: number } }) => void,
    ) => {
      handlers[event] = handler;
      return { remove: jest.fn() };
    }) as unknown as typeof Keyboard.addListener);
    const show = (height: number) =>
      (handlers.keyboardWillShow ?? handlers.keyboardDidShow)?.({ endCoordinates: { height } });
    const hide = () =>
      (handlers.keyboardWillHide ?? handlers.keyboardDidHide)?.({ endCoordinates: { height: 0 } });
    return { show, hide };
  }

  afterEach(() => jest.restoreAllMocks());

  it("meldet die Tastaturhöhe (ein- und ausblenden)", async () => {
    const keyboard = captureKeyboard();
    const { result } = await renderHook(() => useKeyboardInset());
    expect(result.current).toBe(0);
    await act(async () => keyboard.show(320));
    expect(result.current).toBe(320);
    await act(async () => keyboard.hide());
    expect(result.current).toBe(0);
  });

  it("Notiz-Bildschirm rückt Eingabe und „Speichern“ über die Tastatur", async () => {
    const keyboard = captureKeyboard();
    mockNoteState.current = { status: "ready", note: snapshot("Notiz (Beispiel)") };
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const NoteScreen = require("@/app/notiz").default as () => React.JSX.Element;
    await render(<NoteScreen />);
    const padding = () =>
      StyleSheet.flatten(screen.getByTestId("note-screen-scroll").props.contentContainerStyle)
        .paddingBottom as number;
    const before = padding();
    await act(async () => keyboard.show(320));
    const after = padding();
    expect(after).toBeGreaterThanOrEqual(320);
    expect(after).toBeGreaterThan(before);
    expect(screen.getByRole("button", { name: "Speichern" })).toBeOnTheScreen();
  });

  it("Notiz-Bildschirm offline: Erklärung statt Editor", async () => {
    mockNoteState.current = { status: "offline" };
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const NoteScreen = require("@/app/notiz").default as () => React.JSX.Element;
    await render(<NoteScreen />);
    expect(screen.getByText("Ohne Verbindung nicht verfügbar")).toBeOnTheScreen();
    expect(screen.queryByLabelText(`Tagesnotiz für ${LABEL}`)).toBeNull();
  });
});

describe("Datenschutz", () => {
  // Quelltext lesen (ohne Node-Typen im App-Projekt).
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const fs = require("fs") as { readFileSync: (path: string, encoding: "utf8") => string };
  const resolve = (require as unknown as { resolve: (path: string) => string }).resolve;
  const read = (path: string) => fs.readFileSync(resolve(`../${path}`), "utf8");

  it("Erinnerungen, Startbildschirm-Widget und Offline-Plan kennen keine Tagesnotizen", () => {
    for (const file of [
      "lib/notifications.ts",
      "hooks/use-reminder-sync.ts",
      "lib/plan-cache.ts",
      "lib/plan-api.ts",
      "lib/home-widget.ts",
      "hooks/use-widget-sync.ts",
    ]) {
      const source = read(file);
      expect(source).not.toMatch(/daily[-_]?note/i);
      expect(source).not.toMatch(/Tagesnotiz/);
    }
  });
});
