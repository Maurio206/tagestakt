/**
 * Integrationstests der Server Actions mit gemockter Data-Access-Schicht:
 * Eingaben werden mit den gemeinsamen Zod-Schemas geprüft, bevor Daten
 * geschrieben werden, und Fehler werden ohne interne Details gemeldet.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { initialActionState } from "@/lib/form";

const scheduleData = vi.hoisted(() => ({
  createEntry: vi.fn(),
  updateEntry: vi.fn(),
  deleteEntry: vi.fn(),
  deleteDraft: vi.fn(),
  getEntry: vi.fn(),
  getOrCreateDraft: vi.fn(),
  publishDraft: vi.fn(),
  setEntryCompletion: vi.fn(),
  setEntryTimes: vi.fn(),
  updatePlanningNote: vi.fn(),
}));
const recurringData = vi.hoisted(() => ({
  applyRecurringToWeek: vi.fn(),
  createRecurring: vi.fn(),
  deleteRecurring: vi.fn(),
  duplicateRecurring: vi.fn(),
  setRecurringActive: vi.fn(),
  updateRecurring: vi.fn(),
}));
const settingsData = vi.hoisted(() => ({
  saveGoalTargets: vi.fn(),
  saveReminderSettings: vi.fn(),
}));
const activityData = vi.hoisted(() => ({
  correctSession: vi.fn(),
  createManualSession: vi.fn(),
  deleteSession: vi.fn(),
  startSession: vi.fn(),
  stopSession: vi.fn(),
  switchSession: vi.fn(),
}));
const dailyNoteData = vi.hoisted(() => ({
  getDailyNote: vi.fn(),
  listNoteDates: vi.fn(),
  saveDailyNote: vi.fn(),
}));
const supabaseAuth = vi.hoisted(() => ({ signInWithPassword: vi.fn(), signOut: vi.fn() }));

vi.mock("../data/schedule", () => scheduleData);
vi.mock("../data/recurring", () => recurringData);
vi.mock("../data/settings", () => settingsData);
vi.mock("../data/activity", () => activityData);
vi.mock("../data/daily-notes", () => dailyNoteData);
vi.mock("../supabase", () => ({
  createSupabaseServerClient: async () => ({ auth: supabaseAuth }),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((path: string) => {
    throw Object.assign(new Error("NEXT_REDIRECT"), { digest: `NEXT_REDIRECT;${path}` });
  }),
  unstable_rethrow: (error: unknown) => {
    if (error instanceof Error && error.message === "NEXT_REDIRECT") throw error;
  },
}));

const { loginAction } = await import("./auth");
const { createEntryAction, nudgeEntryAction, publishDraftAction, setCompletionAction } =
  await import("./schedule");
const { applyRecurringAction, createRecurringAction } = await import("./recurring");
const { saveGoalsAction, saveRemindersAction } = await import("./settings");
const {
  addManualActivityAction,
  correctActivityAction,
  startActivityAction,
  stopActivityAction,
  switchActivityAction,
} = await import("./activity");
const { saveDailyNoteAction } = await import("./daily-notes");
const { UserFacingError } = await import("../errors");
const { revalidatePath } = await import("next/cache");

const WEEK_ID = "c9f0f895-fb98-4b91-9f5a-1c2d3e4f5a6b";
const ENTRY_ID = "45c48cce-2e2d-4fbd-8a6c-0d1e2f3a4b5c";

function form(values: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.TAGESTAKT_OWNER_USER_ID;
});

describe("createEntryAction", () => {
  const valid = {
    title: "Beispiel",
    category: "business",
    date: "2026-10-06",
    startTime: "09:00",
    endTime: "11:00",
    location: "",
    note: "",
  };

  it("lehnt ungültige Eingaben ab, ohne zu speichern", async () => {
    const state = await createEntryAction(
      WEEK_ID,
      initialActionState,
      form({ ...valid, endTime: "08:00" }),
    );
    expect(state.status).toBe("error");
    expect(state.fieldErrors?.endTime?.[0]).toContain("Endzeit");
    expect(state.values?.title).toBe("Beispiel");
    expect(scheduleData.createEntry).not.toHaveBeenCalled();
  });

  it("speichert gültige Eingaben mit geprüften Daten", async () => {
    const state = await createEntryAction(WEEK_ID, initialActionState, form(valid));
    expect(state.status).toBe("success");
    expect(scheduleData.createEntry).toHaveBeenCalledWith(
      WEEK_ID,
      expect.objectContaining({ title: "Beispiel", location: null, endsNextDay: false }),
    );
  });

  it("lehnt manipulierte IDs ab", async () => {
    const state = await createEntryAction("keine-uuid", initialActionState, form(valid));
    expect(state).toMatchObject({ status: "error", message: "Ungültige Anfrage." });
    expect(scheduleData.createEntry).not.toHaveBeenCalled();
  });

  it("zeigt fachliche Fehler der Data-Access-Schicht an", async () => {
    scheduleData.createEntry.mockRejectedValueOnce(
      new UserFacingError("Nur Entwürfe können bearbeitet werden."),
    );
    const state = await createEntryAction(WEEK_ID, initialActionState, form(valid));
    expect(state).toMatchObject({
      status: "error",
      message: "Nur Entwürfe können bearbeitet werden.",
    });
  });

  it("verrät bei unerwarteten Fehlern keine Details", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    scheduleData.createEntry.mockRejectedValueOnce(
      new Error("relation schedule_entries: interne Details"),
    );
    const state = await createEntryAction(WEEK_ID, initialActionState, form(valid));
    expect(state.message).toBe("Unerwarteter Fehler. Bitte erneut versuchen.");
  });
});

describe("Veröffentlichen und Status", () => {
  it("veröffentlicht und leitet zur Version weiter", async () => {
    scheduleData.publishDraft.mockResolvedValueOnce({});
    await expect(publishDraftAction(WEEK_ID, "2026-10-05")).rejects.toThrow("NEXT_REDIRECT");
    expect(scheduleData.publishDraft).toHaveBeenCalledWith(WEEK_ID);
  });

  it("lehnt eine ungültige Woche ab", async () => {
    const state = await publishDraftAction(WEEK_ID, "2026-10-06");
    expect(state).toMatchObject({ status: "error", message: "Ungültige Woche." });
    expect(scheduleData.publishDraft).not.toHaveBeenCalled();
  });

  it("akzeptiert nur bekannte Erledigt-Status", async () => {
    const state = await setCompletionAction(ENTRY_ID, "published");
    expect(state.status).toBe("error");
    expect(scheduleData.setEntryCompletion).not.toHaveBeenCalled();
    await setCompletionAction(ENTRY_ID, "completed");
    expect(scheduleData.setEntryCompletion).toHaveBeenCalledWith(ENTRY_ID, "completed");
  });
});

describe("applyRecurringAction", () => {
  it("verlangt eine ausdrückliche Bestätigung", async () => {
    const state = await applyRecurringAction(
      initialActionState,
      form({ week: "2026-10-14", mode: "replace" }),
    );
    expect(state.status).toBe("error");
    expect(state.fieldErrors?.confirmed?.[0]).toContain("bestätigen");
    expect(recurringData.applyRecurringToWeek).not.toHaveBeenCalled();
  });

  it("normalisiert auf den Montag und meldet das Ergebnis", async () => {
    recurringData.applyRecurringToWeek.mockResolvedValueOnce({
      weekStart: "2026-10-12",
      version: 2,
      inserted: 5,
      skippedDuplicates: 1,
    });
    const state = await applyRecurringAction(
      initialActionState,
      form({ week: "2026-10-14", mode: "append", confirmed: "on" }),
    );
    expect(recurringData.applyRecurringToWeek).toHaveBeenCalledWith({
      weekStart: "2026-10-12",
      mode: "append",
      confirmed: true,
    });
    expect(state.message).toContain("5 Einträge");
    expect(state.message).toContain("1 bereits vorhandene");
  });
});

describe("saveGoalsAction", () => {
  it("speichert Stunden als Minuten, leere Ziele als null", async () => {
    const state = await saveGoalsAction(
      initialActionState,
      form({
        weeklyBusinessTargetHours: "17,5",
        weeklySportTargetHours: "",
        weeklyRelationshipTargetHours: "1:30",
      }),
    );
    expect(state.status).toBe("success");
    expect(settingsData.saveGoalTargets).toHaveBeenCalledWith({
      weeklyBusinessTargetMinutes: 1050,
      weeklySportTargetMinutes: null,
      weeklyRelationshipTargetMinutes: 90,
    });
  });

  it("speichert ein leeres Gewerbeziel als 0 (kein Ziel)", async () => {
    await saveGoalsAction(initialActionState, form({ weeklyBusinessTargetHours: "" }));
    expect(settingsData.saveGoalTargets).toHaveBeenCalledWith(
      expect.objectContaining({ weeklyBusinessTargetMinutes: 0 }),
    );
  });

  it("markiert ungültige und zu große Werte am Feld", async () => {
    const state = await saveGoalsAction(
      initialActionState,
      form({ weeklyBusinessTargetHours: "20", weeklySportTargetHours: "zwei" }),
    );
    expect(state.status).toBe("error");
    expect(state.fieldErrors?.weeklySportTargetHours?.[0]).toContain("Stunden");
    expect(settingsData.saveGoalTargets).not.toHaveBeenCalled();
    const tooLarge = await saveGoalsAction(
      initialActionState,
      form({ weeklyBusinessTargetHours: "200" }),
    );
    expect(tooLarge.fieldErrors?.weeklyBusinessTargetHours?.[0]).toContain("168");
  });
});

describe("saveRemindersAction", () => {
  it("speichert Vorlauf, Schalter und Umfang", async () => {
    const state = await saveRemindersAction(
      initialActionState,
      form({ reminderMinutesBefore: "15", remindAtStart: "on", reminderScope: "goals" }),
    );
    expect(state.status).toBe("success");
    expect(settingsData.saveReminderSettings).toHaveBeenCalledWith({
      reminderMinutesBefore: 15,
      remindAtStart: true,
      remindIfNotStarted: false,
      reminderScope: "goals",
    });
  });

  it("lehnt einen unbekannten Umfang ab", async () => {
    const state = await saveRemindersAction(
      initialActionState,
      form({ reminderMinutesBefore: "", reminderScope: "alles" }),
    );
    expect(state.status).toBe("error");
    expect(settingsData.saveReminderSettings).not.toHaveBeenCalled();
  });
});

describe("Zeiterfassung", () => {
  const SESSION_ID = "6f1c2d3e-4a5b-4c6d-8e7f-9a0b1c2d3e4f";

  it("startet nur bekannte Ziele, die Zeit setzt der Server", async () => {
    const rejected = await startActivityAction("duty", null);
    expect(rejected.status).toBe("error");
    expect(activityData.startSession).not.toHaveBeenCalled();

    activityData.startSession.mockResolvedValueOnce({ title: "Kundenprojekt (Beispiel)" });
    const state = await startActivityAction("business", ENTRY_ID);
    expect(state).toMatchObject({
      status: "success",
      message: "„Kundenprojekt (Beispiel)“ läuft.",
    });
    expect(activityData.startSession).toHaveBeenCalledWith({
      goal: "business",
      title: null,
      scheduleEntryId: ENTRY_ID,
    });
  });

  it("zeigt die Meldung bei einer bereits laufenden Aktivität", async () => {
    activityData.startSession.mockRejectedValueOnce(
      new UserFacingError("Es läuft bereits eine Aktivität. Bitte zuerst beenden."),
    );
    const state = await startActivityAction("sport", null);
    expect(state.message).toContain("bereits eine Aktivität");
    // Ohne Planblock trägt die Aktivität den Zielnamen.
    expect(activityData.startSession).toHaveBeenCalledWith({
      goal: "sport",
      title: "Sport",
      scheduleEntryId: null,
    });
  });

  it("wechselt atomar in einem Aufruf (kein getrenntes Beenden und Starten)", async () => {
    activityData.switchSession.mockResolvedValueOnce({ title: "Sport" });
    const state = await switchActivityAction(SESSION_ID, "sport", null);
    expect(state).toMatchObject({ status: "success", message: "„Sport“ läuft." });
    expect(activityData.switchSession).toHaveBeenCalledWith(SESSION_ID, {
      goal: "sport",
      title: "Sport",
      scheduleEntryId: null,
    });
    expect(activityData.stopSession).not.toHaveBeenCalled();
    expect(activityData.startSession).not.toHaveBeenCalled();
  });

  it("meldet einen fehlgeschlagenen Wechsel – die bisherige Aktivität läuft weiter", async () => {
    activityData.switchSession.mockRejectedValueOnce(
      new UserFacingError("Der Planblock gehört zu einem anderen Ziel."),
    );
    const state = await switchActivityAction(SESSION_ID, "business", ENTRY_ID);
    expect(state).toMatchObject({ status: "error" });
    expect(activityData.stopSession).not.toHaveBeenCalled();
  });

  it("wechselt nur mit gültiger laufender Aktivität und bekanntem Ziel", async () => {
    expect((await switchActivityAction("keine-uuid", "sport", null)).status).toBe("error");
    expect((await switchActivityAction(SESSION_ID, "duty", null)).status).toBe("error");
    expect(activityData.switchSession).not.toHaveBeenCalled();
  });

  it("beendet nur gültige IDs", async () => {
    const state = await stopActivityAction("keine-uuid");
    expect(state).toMatchObject({ status: "error", message: "Ungültige Anfrage." });
    expect(activityData.stopSession).not.toHaveBeenCalled();
  });

  it("korrigiert in Ortszeit und leitet zur Auswertung zurück", async () => {
    await expect(
      correctActivityAction(
        "2026-10-12",
        initialActionState,
        form({ sessionId: SESSION_ID, date: "2026-10-05", startTime: "17:00", endTime: "18:30" }),
      ),
    ).rejects.toThrow("NEXT_REDIRECT");
    expect(activityData.correctSession).toHaveBeenCalledWith(
      SESSION_ID,
      new Date("2026-10-05T15:00:00Z"),
      new Date("2026-10-05T16:30:00Z"),
    );
  });

  it("meldet Fehler beim Korrigieren am Feld", async () => {
    const state = await correctActivityAction(
      "2026-10-12",
      initialActionState,
      form({ sessionId: SESSION_ID, date: "2026-10-05", startTime: "18:00", endTime: "17:00" }),
    );
    expect(state.fieldErrors?.endTime?.[0]).toBe("Das Ende muss nach dem Beginn liegen");
    expect(activityData.correctSession).not.toHaveBeenCalled();
  });

  it("trägt vergangene Zeit nach", async () => {
    const state = await addManualActivityAction(
      initialActionState,
      form({
        goal: "relationship",
        title: "Spaziergang (Beispiel)",
        date: "2026-10-05",
        startTime: "18:00",
        endTime: "19:00",
      }),
    );
    expect(state.status).toBe("success");
    expect(activityData.createManualSession).toHaveBeenCalledWith({
      goal: "relationship",
      title: "Spaziergang (Beispiel)",
      startedAt: new Date("2026-10-05T16:00:00Z"),
      endedAt: new Date("2026-10-05T17:00:00Z"),
    });
  });
});

describe("Verschieben im Wochenplan", () => {
  const entry = {
    id: ENTRY_ID,
    start_at: "2026-10-12T15:00:00.000Z",
    end_at: "2026-10-12T17:00:00.000Z",
  };

  it("verschiebt um 15 Minuten und bietet Rückgängig an", async () => {
    scheduleData.getEntry.mockResolvedValueOnce(entry);
    let redirectTarget = "";
    try {
      await nudgeEntryAction(ENTRY_ID, "2026-10-12", WEEK_ID, "move", 15);
    } catch (error) {
      redirectTarget = (error as { digest?: string }).digest ?? "";
    }
    expect(scheduleData.setEntryTimes).toHaveBeenCalledWith(
      ENTRY_ID,
      "2026-10-12T15:15:00.000Z",
      "2026-10-12T17:15:00.000Z",
    );
    expect(redirectTarget).toContain("hinweis=verschoben");
    expect(redirectTarget).toContain(`rueckgaengig=${ENTRY_ID}`);
  });

  it("akzeptiert nur feste Schritte", async () => {
    const state = await nudgeEntryAction(ENTRY_ID, "2026-10-12", WEEK_ID, "move", 600);
    expect(state.status).toBe("error");
    expect(scheduleData.setEntryTimes).not.toHaveBeenCalled();
  });

  it("verhindert zu kurze Blöcke", async () => {
    scheduleData.getEntry.mockResolvedValueOnce({ ...entry, end_at: "2026-10-12T15:15:00.000Z" });
    const state = await nudgeEntryAction(ENTRY_ID, "2026-10-12", WEEK_ID, "resize", -15);
    expect(state.message).toContain("mindestens");
    expect(scheduleData.setEntryTimes).not.toHaveBeenCalled();
  });
});

describe("createRecurringAction", () => {
  it("legt eine Wiederholung je gewähltem Wochentag an (Werktage)", async () => {
    const data = form({
      title: "Dienst (Beispiel)",
      category: "duty",
      startTime: "07:00",
      endTime: "16:30",
      active: "on",
      workdays: "on",
    });
    data.append("weekdays", "3");
    const state = await createRecurringAction(initialActionState, data);
    expect(state.message).toContain("5 Wochentage");
    const items = recurringData.createRecurring.mock.calls[0]?.[0] as { weekday: number }[];
    expect(items.map((i) => i.weekday)).toEqual([1, 2, 3, 4, 5]);
  });

  it("verlangt mindestens einen Wochentag", async () => {
    const state = await createRecurringAction(
      initialActionState,
      form({ title: "x", category: "duty", startTime: "07:00", endTime: "08:00" }),
    );
    expect(state.fieldErrors?.weekdays?.[0]).toContain("Wochentag");
    expect(recurringData.createRecurring).not.toHaveBeenCalled();
  });
});

describe("loginAction", () => {
  it("prüft Eingaben vor dem Anmeldeversuch", async () => {
    const state = await loginAction(initialActionState, form({ email: "kein-mail", password: "" }));
    expect(state.status).toBe("error");
    expect(supabaseAuth.signInWithPassword).not.toHaveBeenCalled();
  });

  it("meldet falsche Zugangsdaten neutral und gibt das Passwort nie zurück", async () => {
    supabaseAuth.signInWithPassword.mockResolvedValueOnce({
      data: { user: null },
      error: { code: "invalid_credentials", status: 400, name: "AuthApiError" },
    });
    const state = await loginAction(
      initialActionState,
      form({ email: "demo@tagestakt.test", password: "falsches-passwort" }),
    );
    expect(state).toMatchObject({ status: "error", message: "E-Mail oder Passwort ist falsch." });
    expect(JSON.stringify(state)).not.toContain("falsches-passwort");
  });

  it("weist Konten ab, die nicht als Eigentümer freigeschaltet sind", async () => {
    process.env.TAGESTAKT_OWNER_USER_ID = "8f14e45f-ceea-4f6a-9d1b-6d2c4f0a9b11";
    supabaseAuth.signInWithPassword.mockResolvedValueOnce({
      data: { user: { id: "22222222-2222-4222-8222-222222222222" } },
      error: null,
    });
    const state = await loginAction(
      initialActionState,
      form({ email: "fremd@tagestakt.test", password: "irgendwas" }),
    );
    expect(state.message).toBe("Dieses Konto ist für TagesTakt nicht freigeschaltet.");
    expect(supabaseAuth.signOut).toHaveBeenCalled();
  });

  it("leitet nach erfolgreicher Anmeldung weiter", async () => {
    supabaseAuth.signInWithPassword.mockResolvedValueOnce({
      data: { user: { id: "8f14e45f-ceea-4f6a-9d1b-6d2c4f0a9b11" } },
      error: null,
    });
    await expect(
      loginAction(initialActionState, form({ email: "demo@tagestakt.test", password: "richtig" })),
    ).rejects.toThrow("NEXT_REDIRECT");
  });
});

describe("saveDailyNoteAction", () => {
  const NOTE_ID = "6f9619ff-8b86-4d01-b42d-00c04fc964ff";
  const note = {
    id: NOTE_ID,
    revision: 2,
    content: "Material bereitlegen (Beispiel)\nZweite Zeile",
    updatedAt: "2026-10-14T06:12:00.000Z",
  };

  it("prüft Datum und Länge mit dem gemeinsamen Schema, bevor gespeichert wird", async () => {
    expect(await saveDailyNoteAction({ date: "2026-02-30", content: "x", expected: null })).toEqual(
      { status: "error", message: "Ungültige Anfrage." },
    );
    expect(
      await saveDailyNoteAction({
        date: "2026-10-14",
        content: "a".repeat(10_001),
        expected: null,
      }),
    ).toEqual({
      status: "error",
      message: "Die Notiz ist zu lang (höchstens 10 000 Zeichen).",
    });
    expect(dailyNoteData.saveDailyNote).not.toHaveBeenCalled();
  });

  it("speichert normalisiert (Zeilenumbrüche bleiben) und aktualisiert Übersicht und Wochenplan", async () => {
    dailyNoteData.saveDailyNote.mockResolvedValueOnce({ status: "saved", note });
    const result = await saveDailyNoteAction({
      date: "2026-10-14",
      content: "  Material bereitlegen (Beispiel)\r\nZweite Zeile  ",
      expected: { id: NOTE_ID, revision: 1 },
    });
    expect(dailyNoteData.saveDailyNote).toHaveBeenCalledWith({
      date: "2026-10-14",
      content: "Material bereitlegen (Beispiel)\nZweite Zeile",
      expected: { id: NOTE_ID, revision: 1 },
    });
    expect(result).toEqual({ status: "saved", note, at: note.updatedAt });
    expect(revalidatePath).toHaveBeenCalledWith("/wochenplan");
    expect(revalidatePath).toHaveBeenCalledWith("/");
  });

  it("leerer Inhalt entfernt die Notiz", async () => {
    dailyNoteData.saveDailyNote.mockResolvedValueOnce({ status: "saved", note: null });
    const result = await saveDailyNoteAction({
      date: "2026-10-14",
      content: " \n\t ",
      expected: { id: NOTE_ID, revision: 2 },
    });
    expect(dailyNoteData.saveDailyNote).toHaveBeenCalledWith(
      expect.objectContaining({ content: "" }),
    );
    expect(result).toMatchObject({ status: "saved", note: null });
  });

  it("meldet Konflikte mit dem aktuellen Stand, statt zu überschreiben", async () => {
    dailyNoteData.saveDailyNote.mockResolvedValueOnce({ status: "conflict", latest: note });
    const result = await saveDailyNoteAction({
      date: "2026-10-14",
      content: "Meine Fassung (Beispiel)",
      expected: { id: NOTE_ID, revision: 1 },
    });
    expect(result).toEqual({ status: "conflict", latest: note });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("Fehler ohne interne Details; Protokoll ohne Notizinhalt", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    dailyNoteData.saveDailyNote.mockRejectedValueOnce(
      new Error("relation daily_notes … Geheimer Inhalt (Beispiel)"),
    );
    const result = await saveDailyNoteAction({
      date: "2026-10-14",
      content: "Geheimer Inhalt (Beispiel)",
      expected: null,
    });
    expect(result).toEqual({
      status: "error",
      message: "Nicht gespeichert. Bitte erneut versuchen – dein Text bleibt hier erhalten.",
    });
    expect(JSON.stringify(log.mock.calls)).not.toContain("Geheimer Inhalt");
    log.mockRestore();

    dailyNoteData.saveDailyNote.mockRejectedValueOnce(
      new UserFacingError("Keine Berechtigung für diese Aktion."),
    );
    expect(await saveDailyNoteAction({ date: "2026-10-14", content: "x", expected: null })).toEqual(
      { status: "error", message: "Keine Berechtigung für diese Aktion." },
    );
  });

  it("leitet bei abgelaufener Sitzung weiter (Redirect wird nicht verschluckt)", async () => {
    dailyNoteData.saveDailyNote.mockRejectedValueOnce(
      Object.assign(new Error("NEXT_REDIRECT"), { digest: "NEXT_REDIRECT;/anmelden" }),
    );
    await expect(
      saveDailyNoteAction({ date: "2026-10-14", content: "x", expected: null }),
    ).rejects.toThrow("NEXT_REDIRECT");
  });
});
