/**
 * Server Actions des Wochenplaners mit gemockter Data-Access-Schicht: Anmeldung, Konfiguration,
 * Voraussetzungen, Doppelstarts, Prüfstand (optimistische Nebenläufigkeit) und Veröffentlichen
 * nur nach vollständiger Prüfung. Alle Daten sind frei erfunden.
 */
import { materializeProposal } from "@tagestakt/schedule-schema";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { initialActionState } from "@/lib/form";
import { FAKE_KEY, NOW, OWNER, WEEK, context, proposal } from "@/test/planner-fixtures";

const auth = vi.hoisted(() => ({ authorizedClient: vi.fn() }));
const plannerData = vi.hoisted(() => ({
  getWeekFingerprint: vi.fn(),
  loadPlanningContext: vi.fn(),
  publishReviewedWeek: vi.fn(),
  saveGoalSlots: vi.fn(),
  savePlanningPreferences: vi.fn(),
}));
const scheduleData = vi.hoisted(() => ({
  getWeekWithEntries: vi.fn(),
  listWeekVersions: vi.fn(),
}));
const execute = vi.hoisted(() => ({ executePlanningJob: vi.fn() }));
const session = vi.hoisted(() => ({ getPlannerAccessToken: vi.fn() }));
const after = vi.hoisted(() => vi.fn());

vi.mock("../auth", () => auth);
vi.mock("../data/planner", () => plannerData);
vi.mock("../data/schedule", () => scheduleData);
vi.mock("../planner/execute", () => execute);
vi.mock("../planner/session", () => session);
vi.mock("next/server", () => ({ after }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((path: string) => {
    throw Object.assign(new Error("NEXT_REDIRECT"), { digest: `NEXT_REDIRECT;${path}` });
  }),
  unstable_rethrow: (error: unknown) => {
    if (error instanceof Error && error.message === "NEXT_REDIRECT") throw error;
  },
}));

const {
  publishPlannedWeekAction,
  saveGoalSlotsAction,
  savePlanningPreferencesAction,
  startPlanningAction,
} = await import("./planner");
const { resetPlanningJobs } = await import("../planner/jobs");
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
  resetPlanningJobs();
  process.env.ANTHROPIC_API_KEY = FAKE_KEY;
  delete process.env.ANTHROPIC_MODEL;
  loginAs(OWNER);
  plannerData.loadPlanningContext.mockImplementation(async () => context());
  plannerData.getWeekFingerprint.mockResolvedValue(FINGERPRINT);
  scheduleData.listWeekVersions.mockResolvedValue([]);
  session.getPlannerAccessToken.mockResolvedValue("zugriffstoken-test");
});

afterEach(() => {
  vi.useRealTimers();
  delete process.env.ANTHROPIC_API_KEY;
});

describe("startPlanningAction", () => {
  it("ohne Anmeldung → Login, nichts wird gelesen oder gestartet", async () => {
    loginAs(null);
    await expect(startPlanningAction(WEEK, initialActionState, form({}))).rejects.toThrow(
      "NEXT_REDIRECT",
    );
    expect(plannerData.loadPlanningContext).not.toHaveBeenCalled();
    expect(after).not.toHaveBeenCalled();
  });

  it("fehlender API-Schlüssel → klare Meldung, keine Planung", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const state = await startPlanningAction(WEEK, initialActionState, form({}));
    expect(state).toEqual({
      status: "error",
      message:
        "Der Wochenplaner ist noch nicht eingerichtet: Das Server-Secret ANTHROPIC_API_KEY fehlt.",
    });
    expect(after).not.toHaveBeenCalled();
  });

  it("fehlende Angaben → konkrete Liste, keine Planung", async () => {
    plannerData.loadPlanningContext.mockResolvedValue(context({ preferences: null }));
    const state = await startPlanningAction(WEEK, initialActionState, form({}));
    expect(state.status).toBe("error");
    expect(state.message).toContain("Planungsregeln für Gewerbe fehlen");
    expect(after).not.toHaveBeenCalled();
  });

  it("vergangene oder zu ferne Wochen werden nicht geplant", async () => {
    for (const week of ["2026-09-28", "2026-11-16", "2026-10-13", "kein-datum"]) {
      const state = await startPlanningAction(week, initialActionState, form({}));
      expect(state.message).toBe("Diese Woche kann nicht geplant werden.");
    }
    expect(after).not.toHaveBeenCalled();
  });

  it("startet genau einen Auftrag für den angemeldeten Benutzer (fremde IDs werden ignoriert)", async () => {
    const state = await startPlanningAction(
      WEEK,
      initialActionState,
      form({ owner_id: FOREIGN, ownerId: FOREIGN }),
    );
    expect(state.status).toBe("success");
    expect(after).toHaveBeenCalledTimes(1);
    const job = after.mock.calls[0]?.[0] as () => unknown;
    job();
    expect(execute.executePlanningJob).toHaveBeenCalledWith(
      expect.objectContaining({
        ownerId: OWNER,
        weekStart: WEEK,
        expected: null,
        accessToken: "zugriffstoken-test",
        config: { apiKey: FAKE_KEY, model: "claude-opus-5-5" },
      }),
    );
    expect(JSON.stringify(execute.executePlanningJob.mock.calls)).not.toContain(FOREIGN);
  });

  it("doppelter Klick startet keine zweite Planung", async () => {
    await startPlanningAction(WEEK, initialActionState, form({}));
    const second = await startPlanningAction(WEEK, initialActionState, form({}));
    expect(second).toEqual({ status: "success", message: "Die Planung läuft bereits." });
    expect(after).toHaveBeenCalledTimes(1);
  });

  it("„Neu planen“ ersetzt nur den angezeigten Entwurfsstand", async () => {
    scheduleData.listWeekVersions.mockResolvedValue([{ id: DRAFT_ID, status: "draft" }]);
    const stale = await startPlanningAction(
      WEEK,
      initialActionState,
      form({ entwurf: DRAFT_ID, stand: "b".repeat(64) }),
    );
    expect(stale.message).toContain("inzwischen geändert");
    const missing = await startPlanningAction(WEEK, initialActionState, form({}));
    expect(missing.status).toBe("error");
    expect(after).not.toHaveBeenCalled();

    const ok = await startPlanningAction(
      WEEK,
      initialActionState,
      form({ entwurf: DRAFT_ID, stand: FINGERPRINT }),
    );
    expect(ok.status).toBe("success");
    (after.mock.calls[0]?.[0] as () => unknown)();
    expect(execute.executePlanningJob).toHaveBeenCalledWith(
      expect.objectContaining({ expected: { draftId: DRAFT_ID, fingerprint: FINGERPRINT } }),
    );
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

  it("unvollständiger Entwurf (Pflichtregel verletzt) wird nicht veröffentlicht", async () => {
    scheduleData.getWeekWithEntries.mockResolvedValue(
      draftWeek(plannedEntries().filter((e) => e.category !== "sport")),
    );
    const state = await publishPlannedWeekAction(
      DRAFT_ID,
      WEEK,
      initialActionState,
      form({ stand: FINGERPRINT }),
    );
    expect(state.status).toBe("error");
    expect(state.message).toContain("Training am Mo 12.10. fehlt");
    expect(plannerData.publishReviewedWeek).not.toHaveBeenCalled();
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
