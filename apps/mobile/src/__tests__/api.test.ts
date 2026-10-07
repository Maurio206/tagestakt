import { correctActivity, startActivity, stopActivity, switchActivity } from "@/lib/activity-api";
import { type TypedSupabaseClient } from "@/lib/supabase";
import { stepTime } from "@/lib/time-step";
import { OFFLINE_MESSAGE, WriteError, toWriteError } from "@/lib/write-errors";

import { businessBlock, session } from "./fixtures";

describe("Fehlermeldungen beim Schreiben", () => {
  it("übersetzt Fachfehler der Datenbank", () => {
    expect(toWriteError({ code: "TT001" }).message).toMatch(/läuft bereits/i);
    expect(toWriteError({ code: "23505", message: "duplicate key value" }).message).toMatch(
      /läuft bereits/i,
    );
    expect(toWriteError({ code: "42501", message: "permission denied for table x" }).message).toBe(
      "Keine Berechtigung für diese Aktion.",
    );
  });

  it("zeigt keine internen Details", () => {
    const message = toWriteError({
      code: "XX000",
      message: "relation public.secret does not exist",
    }).message;
    expect(message).toBe("Speichern fehlgeschlagen.");
  });

  it("erkennt fehlende Verbindung", () => {
    expect(toWriteError(new TypeError("Network request failed")).message).toBe(OFFLINE_MESSAGE);
  });
});

describe("Aktivitäten-API", () => {
  function fakeClient(response: { data: unknown; error: unknown }) {
    const rpc = jest.fn(async () => response);
    return { client: { rpc } as unknown as TypedSupabaseClient, rpc };
  }
  const row = session("business", "2026-10-06T15:00:00.000Z", null);

  it("startet ohne Planblock mit dem Zielnamen als Titel (Serverzeit)", async () => {
    const { client, rpc } = fakeClient({ data: row, error: null });
    await startActivity(client, { goal: "business", scheduleEntryId: null });
    expect(rpc).toHaveBeenCalledWith("start_activity_session", {
      p_goal_category: "business",
      p_title: "Gewerbe",
    });
  });

  it("verknüpft den Planblock, wenn vorhanden", async () => {
    const { client, rpc } = fakeClient({ data: row, error: null });
    await startActivity(client, { goal: "business", scheduleEntryId: businessBlock.id });
    expect(rpc).toHaveBeenCalledWith("start_activity_session", {
      p_goal_category: "business",
      p_schedule_entry_id: businessBlock.id,
    });
  });

  it("wechselt atomar mit einem einzigen Serveraufruf", async () => {
    const { client, rpc } = fakeClient({ data: row, error: null });
    await switchActivity(client, {
      runningSessionId: row.id,
      goal: "sport",
      scheduleEntryId: null,
    });
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("switch_activity_session", {
      p_session_id: row.id,
      p_goal_category: "sport",
      p_title: "Sport",
    });
  });

  it("meldet einen abgewiesenen Wechsel verständlich (laufende Aktivität bleibt)", async () => {
    const { client } = fakeClient({ data: null, error: { code: "TT005", message: "intern" } });
    await expect(
      switchActivity(client, {
        runningSessionId: row.id,
        goal: "business",
        scheduleEntryId: businessBlock.id,
      }),
    ).rejects.toThrow(WriteError);
  });

  it("wechselt nicht mit ungültiger laufender Aktivität", async () => {
    const { client, rpc } = fakeClient({ data: row, error: null });
    await expect(
      switchActivity(client, {
        runningSessionId: "keine-uuid",
        goal: "sport",
        scheduleEntryId: null,
      }),
    ).rejects.toBeInstanceOf(WriteError);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("lehnt ungültige IDs ab, ohne den Server zu fragen", async () => {
    const { client, rpc } = fakeClient({ data: row, error: null });
    await expect(stopActivity(client, "keine-uuid")).rejects.toBeInstanceOf(WriteError);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("prüft Korrekturen mit dem gemeinsamen Schema (Ende nach Beginn)", async () => {
    const { client, rpc } = fakeClient({ data: row, error: null });
    await expect(
      correctActivity(client, {
        sessionId: row.id,
        startedAt: "2026-10-06T12:00:00.000Z",
        endedAt: "2026-10-06T11:00:00.000Z",
      }),
    ).rejects.toThrow("Das Ende muss nach dem Beginn liegen");
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe("Zeit korrigieren – Schritte", () => {
  it("rastet auf 5- bzw. 15-Minuten-Schritte ein", () => {
    const t = new Date("2026-10-06T15:03:20Z");
    expect(stepTime(t, 1, 5).toISOString()).toBe("2026-10-06T15:05:00.000Z");
    expect(stepTime(t, -1, 5).toISOString()).toBe("2026-10-06T15:00:00.000Z");
    expect(stepTime(new Date("2026-10-06T15:15:00Z"), 1, 15).toISOString()).toBe(
      "2026-10-06T15:30:00.000Z",
    );
    expect(stepTime(new Date("2026-10-06T15:15:00Z"), -1, 15).toISOString()).toBe(
      "2026-10-06T15:00:00.000Z",
    );
  });

  it("verschiebt über Mitternacht ohne Sonderfall", () => {
    expect(stepTime(new Date("2026-10-06T22:00:00Z"), -1, 15).toISOString()).toBe(
      "2026-10-06T21:45:00.000Z",
    );
  });
});
