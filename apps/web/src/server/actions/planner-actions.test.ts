/**
 * Server Actions der Wochenplanung mit gemockter Data-Access-Schicht: Anmeldung, Prüfstand
 * (optimistische Nebenläufigkeit), Veröffentlichen nur nach vollständiger Prüfung und
 * Planungsregeln. Die Website ruft kein Sprachmodell auf. Alle Daten sind frei erfunden.
 */
import { materializeProposal } from "@tagestakt/schedule-schema";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { initialActionState } from "@/lib/form";
import { NOW, OWNER, WEEK, context, proposal } from "@/test/planning-fixtures";

const auth = vi.hoisted(() => ({ authorizedClient: vi.fn() }));
const plannerData = vi.hoisted(() => ({
  loadPlanningContext: vi.fn(),
  publishReviewedWeek: vi.fn(),
  saveGoalSlots: vi.fn(),
  savePlanningPreferences: vi.fn(),
}));
const scheduleData = vi.hoisted(() => ({
  getWeekWithEntries: vi.fn(),
}));

vi.mock("../auth", () => auth);
vi.mock("../data/planner", () => plannerData);
vi.mock("../data/schedule", () => scheduleData);
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((path: string) => {
    throw Object.assign(new Error("NEXT_REDIRECT"), { digest: `NEXT_REDIRECT;${path}` });
  }),
  unstable_rethrow: (error: unknown) => {
    if (error instanceof Error && error.message === "NEXT_REDIRECT") throw error;
  },
}));

const planner = await import("./planner");
const { publishPlannedWeekAction, saveGoalSlotsAction, savePlanningPreferencesAction } = planner;
const { UserFacingError } = await import("../errors");

const DRAFT_ID = "c9f0f895-fb98-4b91-9f5a-1c2d3e4f5a6b";
const FINGERPRINT = "a".repeat(64);
const FOREIGN = "22222222-2222-4222-8222-222222222222";

function form(values: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}

function draftWeek(entries = plannedEntries()) {
  return {
    id: DRAFT_ID,
    week_start: WEEK,
    status: "draft",
    version: 2,
    schedule_entries: entries,
  };
}

function plannedEntries() {
  const result = materializeProposal(context(), proposal());
  if (!result.ok) throw new Error(result.errors.join("\n"));
  return result.entries.map((entry) => ({ ...entry, completion_status: "planned" as const }));
}

function loginAs(id: string | null) {
  auth.authorizedClient.mockImplementation(async () => {
    if (!id) {
      throw Object.assign(new Error("NEXT_REDIRECT"), { digest: "NEXT_REDIRECT;/login" });
    }
    return { supabase: { auth: {} }, user: { id } };
  });
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  vi.clearAllMocks();
  loginAs(OWNER);
  plannerData.loadPlanningContext.mockImplementation(async () => context());
});

afterEach(() => {
  vi.useRealTimers();
});

describe("Keine Planung über ein Sprachmodell in der Website", () => {
  it("es gibt keine Action, die eine Planung startet", () => {
    expect(Object.keys(planner).sort()).toEqual([
      "publishPlannedWeekAction",
      "saveGoalSlotsAction",
      "savePlanningPreferencesAction",
    ]);
  });
});

describe("publishPlannedWeekAction", () => {
  it("ohne gültigen Prüfstand wird nichts veröffentlicht", async () => {
    const state = await publishPlannedWeekAction(
      DRAFT_ID,
      WEEK,
      initialActionState,
      form({ stand: "kein-pruefstand" }),
    );
    expect(state.status).toBe("error");
    expect(plannerData.publishReviewedWeek).not.toHaveBeenCalled();
  });

  it("Entwurf mit verletzter Pflichtregel (Gewerbe im Dienst) wird nicht veröffentlicht", async () => {
    const duringDuty = {
      title: "Gewerbe im Dienst (Beispiel)",
      category: "business" as const,
      start_at: "2026-10-14T07:00:00.000Z",
      end_at: "2026-10-14T08:00:00.000Z",
      location: null,
      note: null,
      source: "agent" as const,
      completion_status: "planned" as const,
    };
    scheduleData.getWeekWithEntries.mockResolvedValue(draftWeek([...plannedEntries(), duringDuty]));
    const state = await publishPlannedWeekAction(
      DRAFT_ID,
      WEEK,
      initialActionState,
      form({ stand: FINGERPRINT }),
    );
    expect(state.status).toBe("error");
    expect(state.message).toContain("Dienstzeit nicht als Gewerbe gezählt");
    expect(plannerData.publishReviewedWeek).not.toHaveBeenCalled();
  });

  it("Abweichung von einer Regel (Training fehlt) ist sichtbar, verhindert aber nichts", async () => {
    const entries = plannedEntries().filter((e) => e.category !== "sport");
    scheduleData.getWeekWithEntries.mockResolvedValue(draftWeek(entries));
    plannerData.publishReviewedWeek.mockResolvedValue({ status: "published" });
    await expect(
      publishPlannedWeekAction(DRAFT_ID, WEEK, initialActionState, form({ stand: FINGERPRINT })),
    ).rejects.toThrow("NEXT_REDIRECT");
    expect(plannerData.loadPlanningContext).toHaveBeenCalledWith(WEEK, expect.any(Date), entries);
    expect(plannerData.publishReviewedWeek).toHaveBeenCalledWith(DRAFT_ID, FINGERPRINT);
  });

  it("geprüfter Entwurf wird mit genau diesem Prüfstand veröffentlicht", async () => {
    scheduleData.getWeekWithEntries.mockResolvedValue(draftWeek());
    plannerData.publishReviewedWeek.mockResolvedValue({ status: "published" });
    await expect(
      publishPlannedWeekAction(DRAFT_ID, WEEK, initialActionState, form({ stand: FINGERPRINT })),
    ).rejects.toMatchObject({
      digest: `NEXT_REDIRECT;/planen?woche=${WEEK}&hinweis=veroeffentlicht`,
    });
    expect(plannerData.publishReviewedWeek).toHaveBeenCalledWith(DRAFT_ID, FINGERPRINT);
  });

  it("zweiter Klick nach dem Veröffentlichen ist harmlos (idempotent)", async () => {
    scheduleData.getWeekWithEntries.mockResolvedValue({ ...draftWeek(), status: "published" });
    await expect(
      publishPlannedWeekAction(DRAFT_ID, WEEK, initialActionState, form({ stand: FINGERPRINT })),
    ).rejects.toThrow("NEXT_REDIRECT");
    expect(plannerData.publishReviewedWeek).not.toHaveBeenCalled();
  });

  it("inzwischen geänderter Entwurf (TT008) → Meldung statt Veröffentlichung", async () => {
    scheduleData.getWeekWithEntries.mockResolvedValue(draftWeek());
    plannerData.publishReviewedWeek.mockRejectedValue(
      new UserFacingError("Der Entwurf wurde inzwischen geändert."),
    );
    const state = await publishPlannedWeekAction(
      DRAFT_ID,
      WEEK,
      initialActionState,
      form({ stand: FINGERPRINT }),
    );
    expect(state).toEqual({ status: "error", message: "Der Entwurf wurde inzwischen geändert." });
  });
});

describe("Planungsregeln speichern", () => {
  const rules = {
    businessEarliestStart: "08:00",
    businessLatestEnd: "21:00",
    businessMinBlockMinutes: "60",
    businessMaxBlockMinutes: "240",
    businessMaxDailyMinutes: "300",
    businessSaturdayMaxMinutes: "0",
    businessSundayMaxMinutes: "0",
    bufferMinutes: "15",
  };

  it("leere oder widersprüchliche Angaben werden nicht gespeichert", async () => {
    const state = await savePlanningPreferencesAction(
      initialActionState,
      form({ ...rules, businessMaxBlockMinutes: "30", businessEarliestStart: "" }),
    );
    expect(state.status).toBe("error");
    expect(state.fieldErrors?.businessMaxBlockMinutes).toBeDefined();
    expect(state.fieldErrors?.businessEarliestStart).toBeDefined();
    expect(plannerData.savePlanningPreferences).not.toHaveBeenCalled();
  });

  it("speichert geprüfte Werte ohne Besitzer-ID aus dem Formular", async () => {
    const state = await savePlanningPreferencesAction(
      initialActionState,
      form({ ...rules, owner_id: FOREIGN }),
    );
    expect(state.status).toBe("success");
    const [saved] = plannerData.savePlanningPreferences.mock.calls[0] as [Record<string, unknown>];
    expect(saved).toMatchObject({ businessMinBlockMinutes: 60, bufferMinutes: 15 });
    expect(saved).not.toHaveProperty("owner_id");
  });

  it("Zeitfenster: Fehler je Wochentag, gespeichert werden nur aktive Tage", async () => {
    const invalid = await saveGoalSlotsAction(
      "sport",
      initialActionState,
      form({
        "slot-1-active": "on",
        "slot-1-requirement": "required",
        "slot-1-title": "Training",
        "slot-1-duration": "240",
        "slot-1-start": "18:00",
        "slot-1-end": "19:00",
      }),
    );
    expect(invalid.fieldErrors?.["slot-1-duration"]?.[0]).toBe(
      "Die Dauer passt nicht in das Zeitfenster.",
    );
    expect(plannerData.saveGoalSlots).not.toHaveBeenCalled();

    const valid = await saveGoalSlotsAction(
      "sport",
      initialActionState,
      form({
        "slot-1-active": "on",
        "slot-1-requirement": "required",
        "slot-1-title": "Training",
        "slot-1-duration": "60",
        "slot-1-start": "18:00",
        "slot-1-end": "21:00",
        "slot-3-requirement": "optional",
        "slot-3-title": "Training",
      }),
    );
    expect(valid.status).toBe("success");
    expect(plannerData.saveGoalSlots).toHaveBeenCalledWith({
      goal: "sport",
      slots: [
        {
          weekday: 1,
          requirement: "required",
          title: "Training",
          durationMinutes: 60,
          windowStart: "18:00",
          windowEnd: "21:00",
        },
      ],
    });
  });

  it("unbekanntes Ziel wird abgelehnt", async () => {
    const state = await saveGoalSlotsAction("business" as never, initialActionState, form({}));
    expect(state.status).toBe("error");
    expect(plannerData.saveGoalSlots).not.toHaveBeenCalled();
  });
});
