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
  getOrCreateDraft: vi.fn(),
  publishDraft: vi.fn(),
  setEntryCompletion: vi.fn(),
  updatePlanningNote: vi.fn(),
}));
const recurringData = vi.hoisted(() => ({
  applyRecurringToWeek: vi.fn(),
  createRecurring: vi.fn(),
  deleteRecurring: vi.fn(),
  setRecurringActive: vi.fn(),
  updateRecurring: vi.fn(),
}));
const settingsData = vi.hoisted(() => ({ saveWeeklyTarget: vi.fn() }));
const supabaseAuth = vi.hoisted(() => ({ signInWithPassword: vi.fn(), signOut: vi.fn() }));

vi.mock("../data/schedule", () => scheduleData);
vi.mock("../data/recurring", () => recurringData);
vi.mock("../data/settings", () => settingsData);
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
const { createEntryAction, publishDraftAction, setCompletionAction } = await import("./schedule");
const { applyRecurringAction } = await import("./recurring");
const { saveSettingsAction } = await import("./settings");
const { UserFacingError } = await import("../errors");

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

describe("saveSettingsAction", () => {
  it("speichert Stunden als Minuten", async () => {
    const state = await saveSettingsAction(
      initialActionState,
      form({ weeklyBusinessTargetHours: "17,5" }),
    );
    expect(state.status).toBe("success");
    expect(settingsData.saveWeeklyTarget).toHaveBeenCalledWith(1050);
  });

  it("lehnt ungültige Werte ab", async () => {
    const state = await saveSettingsAction(
      initialActionState,
      form({ weeklyBusinessTargetHours: "200" }),
    );
    expect(state.status).toBe("error");
    expect(settingsData.saveWeeklyTarget).not.toHaveBeenCalled();
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
