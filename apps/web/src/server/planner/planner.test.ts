/**
 * Wochenplaner (Server): Konfiguration, Auftragsverwaltung, Anthropic-Aufruf (mit gefälschtem
 * Client, ohne Netzwerk) und der Planungsablauf mit strenger Prüfung der Modellantwort.
 * Alle Beispieldaten sind frei erfunden.
 */
import Anthropic from "@anthropic-ai/sdk";
import {
  type PlannerModelInput,
  type PlannerProposal,
  type PlanningContext,
} from "@tagestakt/schedule-schema";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { findPublicAnthropicVariables, validateServerConfiguration } from "../config-check";
import { UserFacingError } from "../errors";
import {
  PlannerModelError,
  type ProposalRequester,
  createAnthropicRequester,
  toPlannerModelError,
} from "./anthropic";
import { DEFAULT_PLANNER_MODEL, readPlannerConfig } from "./config";
import {
  PLANNER_MAX_STARTS_PER_HOUR,
  PLANNER_STALE_AFTER_MS,
  finishPlanningJob,
  getPlanningJob,
  reservePlanningJob,
  resetPlanningJobs,
} from "./jobs";
import { PLANNER_SYSTEM_PROMPT, buildPlannerUserMessage } from "./prompt";
import { buildPlanningNote, runPlanning } from "./service";
import {
  FAKE_KEY,
  INJECTION,
  OWNER,
  WEEK,
  business,
  commitment,
  context,
  proposal,
} from "@/test/planner-fixtures";

function requesterReturning(...answers: unknown[]) {
  const calls: { input: PlannerModelInput; previousErrors: readonly string[] }[] = [];
  const requester: ProposalRequester = async (input, { previousErrors }) => {
    calls.push({ input, previousErrors });
    const answer = answers[Math.min(calls.length - 1, answers.length - 1)];
    if (answer instanceof Error) throw answer;
    return answer;
  };
  return { requester, calls };
}

async function run(ctx: PlanningContext, requester: ProposalRequester) {
  const save = vi.fn(async () => ({ draftId: "draft-1" }));
  const result = await runPlanning({
    context: ctx,
    requester,
    save,
    signal: new AbortController().signal,
  });
  return { result, save };
}

let errorSpy: ReturnType<typeof vi.spyOn>;
let logSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
  logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
});
afterEach(() => {
  errorSpy.mockRestore();
  logSpy.mockRestore();
  resetPlanningJobs();
});

/** Protokolle dürfen keine Inhalte, Titel, Notizen oder Schlüssel enthalten. */
function expectCleanLogs() {
  const logged = JSON.stringify([...errorSpy.mock.calls, ...logSpy.mock.calls]);
  for (const forbidden of ["Beispiel", "Gewerbe-Fokus", "Training", FAKE_KEY, INJECTION]) {
    expect(logged).not.toContain(forbidden);
  }
}

describe("Konfiguration", () => {
  it("fehlender Schlüssel → klare Meldung ohne Absturz", () => {
    const result = readPlannerConfig({});
    expect(result).toEqual({
      ok: false,
      message:
        "Der Wochenplaner ist noch nicht eingerichtet: Das Server-Secret ANTHROPIC_API_KEY fehlt.",
    });
  });

  it("ungültiger Schlüssel oder ungültiges Modell werden abgelehnt, ohne Werte zu nennen", () => {
    const invalid = readPlannerConfig({ ANTHROPIC_API_KEY: "kurz" });
    expect(invalid.ok).toBe(false);
    if (!invalid.ok) expect(invalid.message).not.toContain("kurz");
    expect(
      readPlannerConfig({ ANTHROPIC_API_KEY: FAKE_KEY, ANTHROPIC_MODEL: "gpt-irgendwas" }).ok,
    ).toBe(false);
  });

  it("Modell ist per Server-Variable einstellbar, Standard ist das aktuelle Opus", () => {
    expect(readPlannerConfig({ ANTHROPIC_API_KEY: FAKE_KEY })).toEqual({
      ok: true,
      config: { apiKey: FAKE_KEY, model: DEFAULT_PLANNER_MODEL },
    });
    const custom = readPlannerConfig({
      ANTHROPIC_API_KEY: FAKE_KEY,
      ANTHROPIC_MODEL: "claude-sonnet-5-5",
    });
    expect(custom.ok && custom.config.model).toBe("claude-sonnet-5-5");
  });

  it("öffentliche Anthropic-Variablen verhindern den Start (Browser-Bundle)", () => {
    expect(
      findPublicAnthropicVariables({
        NEXT_PUBLIC_ANTHROPIC_API_KEY: "x",
        EXPO_PUBLIC_CLAUDE_KEY: "x",
        ANTHROPIC_API_KEY: "x",
        NEXT_PUBLIC_SUPABASE_URL: "x",
      }),
    ).toEqual(["NEXT_PUBLIC_ANTHROPIC_API_KEY", "EXPO_PUBLIC_CLAUDE_KEY"]);
    const problems = validateServerConfiguration({
      NODE_ENV: "development",
      NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_platzhalter",
      NEXT_PUBLIC_ANTHROPIC_API_KEY: FAKE_KEY,
    });
    expect(problems.join()).toContain("NEXT_PUBLIC_ANTHROPIC_API_KEY ist öffentlich");
    expect(problems.join()).not.toContain(FAKE_KEY);
  });
});

describe("Planungsaufträge", () => {
  it("ein zweiter Start während einer laufenden Planung startet nichts (Doppelklick)", () => {
    const first = reservePlanningJob(OWNER, WEEK, 1_000);
    expect(first.ok).toBe(true);
    const second = reservePlanningJob(OWNER, WEEK, 2_000);
    expect(second).toMatchObject({ ok: false, reason: "running" });
  });

  it("begrenzt Planungen je Stunde", () => {
    for (let i = 0; i < PLANNER_MAX_STARTS_PER_HOUR; i += 1) {
      const reserved = reservePlanningJob(OWNER, WEEK, 1_000 + i);
      expect(reserved.ok).toBe(true);
      finishPlanningJob(
        OWNER,
        1_000 + i,
        { status: "failed", message: "x", details: [] },
        1_000 + i,
      );
    }
    expect(reservePlanningJob(OWNER, WEEK, 5_000)).toEqual({ ok: false, reason: "rate-limit" });
    expect(reservePlanningJob(OWNER, WEEK, 1_000 + 60 * 60_000 + 1).ok).toBe(true);
  });

  it("hängende Aufträge gelten nach Ablauf als fehlgeschlagen", () => {
    reservePlanningJob(OWNER, WEEK, 0);
    expect(getPlanningJob(OWNER, PLANNER_STALE_AFTER_MS + 1)?.status).toBe("failed");
  });

  it("ein alter Auftrag überschreibt nie das Ergebnis eines neueren", () => {
    reservePlanningJob(OWNER, WEEK, 0);
    getPlanningJob(OWNER, PLANNER_STALE_AFTER_MS + 1);
    reservePlanningJob(OWNER, WEEK, PLANNER_STALE_AFTER_MS + 2);
    finishPlanningJob(OWNER, 0, { status: "succeeded", draftId: "alt", warnings: [] });
    expect(getPlanningJob(OWNER, PLANNER_STALE_AFTER_MS + 3)?.status).toBe("running");
  });

  it("Aufträge sind je Benutzer getrennt", () => {
    reservePlanningJob(OWNER, WEEK, 0);
    expect(getPlanningJob("22222222-2222-4222-8222-222222222222", 1)).toBeUndefined();
  });
});

describe("Anthropic-Aufruf", () => {
  function fakeClient(message: Partial<Anthropic.Beta.BetaMessage>) {
    const stream = vi.fn(() => ({ finalMessage: async () => message }));
    return { client: { beta: { messages: { stream } } } as unknown as Anthropic, stream };
  }
  const config = { apiKey: FAKE_KEY, model: "claude-opus-5-5" };
  const input = () => ({ previousErrors: [] as string[], signal: new AbortController().signal });

  it("strukturierte Ausgabe mit JSON-Schema, Ausweichmodell und ohne Inhalte im Systemprompt", async () => {
    const { client, stream } = fakeClient({
      stop_reason: "end_turn",
      content: [{ type: "text", text: JSON.stringify(proposal()), citations: null }],
    });
    const answer = await createAnthropicRequester(config, client)(
      { timezone: "Europe/Berlin" } as PlannerModelInput,
      input(),
    );
    expect(answer).toEqual(proposal());
    const [params, options] = stream.mock.calls[0] as unknown as [
      Record<string, unknown>,
      { signal: AbortSignal },
    ];
    expect(params.model).toBe("claude-opus-5-5");
    expect(params.output_config).toMatchObject({
      effort: "high",
      format: { type: "json_schema" },
    });
    expect(params.fallbacks).toBe("default");
    expect(params.betas).toEqual(["server-side-fallback-2026-07-01"]);
    expect(params).not.toHaveProperty("thinking");
    expect(options.signal).toBeInstanceOf(AbortSignal);
    expect(params.system).toBe(PLANNER_SYSTEM_PROMPT);
  });

  it("Modelle ohne Ausweichlösung bekommen keine Ausweich-Parameter", async () => {
    const { client, stream } = fakeClient({
      stop_reason: "end_turn",
      content: [{ type: "text", text: "{}", citations: null }],
    });
    await createAnthropicRequester({ ...config, model: "claude-haiku-5-5" }, client)(
      {} as PlannerModelInput,
      input(),
    );
    const [params] = stream.mock.calls[0] as unknown as [Record<string, unknown>];
    expect(params).not.toHaveProperty("fallbacks");
    expect(params).not.toHaveProperty("betas");
  });

  it("Ablehnung, abgeschnittene Antwort und kein JSON → verständliche Fehler", async () => {
    for (const [message, code] of [
      [{ stop_reason: "refusal", content: [] }, "refusal"],
      [{ stop_reason: "max_tokens", content: [] }, "truncated"],
      [
        {
          stop_reason: "end_turn",
          content: [{ type: "text", text: "kein JSON", citations: null }],
        },
        "invalid-response",
      ],
    ] as const) {
      const { client } = fakeClient(message as unknown as Partial<Anthropic.Beta.BetaMessage>);
      await expect(
        createAnthropicRequester(config, client)({} as PlannerModelInput, input()),
      ).rejects.toMatchObject({ code });
    }
  });

  it("SDK-Fehler werden auf feste Meldungen abgebildet (Zeitüberschreitung, Schlüssel, Last)", () => {
    expect(toPlannerModelError(new Anthropic.APIConnectionTimeoutError()).code).toBe("timeout");
    expect(toPlannerModelError(new Anthropic.APIUserAbortError()).code).toBe("aborted");
    expect(toPlannerModelError(new Anthropic.APIConnectionError({ message: "x" })).code).toBe(
      "unavailable",
    );
    const headers = new Headers();
    expect(
      toPlannerModelError(new Anthropic.AuthenticationError(401, undefined, "x", headers)).code,
    ).toBe("auth");
    expect(
      toPlannerModelError(new Anthropic.RateLimitError(429, undefined, "x", headers)).code,
    ).toBe("rate-limit");
    expect(
      toPlannerModelError(new Anthropic.InternalServerError(529, undefined, "x", headers)).code,
    ).toBe("unavailable");
    expect(toPlannerModelError(new Error("geheim")).message).not.toContain("geheim");
  });
});

describe("Planungsablauf", () => {
  it("gültiger Vorschlag → genau ein Speichern mit festen Terminen und geprüften Blöcken", async () => {
    const { requester, calls } = requesterReturning(proposal());
    const { result, save } = await run(context(), requester);
    expect(result).toEqual({
      status: "succeeded",
      draftId: "draft-1",
      warnings: ["Mittwoch ohne Training (Beispiel)."],
    });
    expect(calls).toHaveLength(1);
    expect(save).toHaveBeenCalledTimes(1);
    const [entries, note] = save.mock.calls[0] as unknown as [
      { title: string; category: string; source: string }[],
      string,
    ];
    expect(entries.filter((e) => e.source === "recurring")).toHaveLength(5);
    expect(entries.filter((e) => e.source === "agent")).toHaveLength(7);
    // Titel für Training und Beziehungszeit stammen aus den Einstellungen, nicht vom Modell.
    expect(entries.find((e) => e.category === "relationship")?.title).toBe(
      "Zeit zu zweit (Beispiel)",
    );
    expect(note).toContain("Gewerbe täglich nach dem Dienst (Beispiel).");
    expectCleanLogs();
  });

  it("fehlende Angaben → keine Anfrage an Claude, nichts gespeichert", async () => {
    const { requester, calls } = requesterReturning(proposal());
    const { result, save } = await run(context({ preferences: null, slots: [] }), requester);
    expect(result.status).toBe("failed");
    if (result.status === "failed") {
      expect(result.message).toContain("Es fehlen Angaben");
      expect(result.details.join()).toContain("Planungsregeln für Gewerbe fehlen");
    }
    expect(calls).toHaveLength(0);
    expect(save).not.toHaveBeenCalled();
  });

  it("nicht erfüllbare Pflichtregeln → Konflikt statt stiller Kürzung, keine Anfrage", async () => {
    const { requester, calls } = requesterReturning(proposal());
    const ctx = context({
      commitments: ([1, 2, 3, 4, 5] as const).map((d) => commitment(d, "08:00", "20:00")),
    });
    const { result, save } = await run(ctx, requester);
    expect(result.status).toBe("failed");
    if (result.status === "failed") expect(result.details.join()).toContain("Gewerbe-Minimum");
    expect(calls).toHaveLength(0);
    expect(save).not.toHaveBeenCalled();
  });

  it("ungültige Antwort wird einmal mit den Prüffehlern korrigiert", async () => {
    const invalid = { ...proposal(), extra: "unbekanntes Feld" };
    const { requester, calls } = requesterReturning(invalid, proposal());
    const { result, save } = await run(context(), requester);
    expect(result.status).toBe("succeeded");
    expect(calls).toHaveLength(2);
    expect(calls[1]?.previousErrors.join()).toContain("unrecognized_keys");
    expect(save).toHaveBeenCalledTimes(1);
  });

  const rejected: [string, PlannerProposal | Record<string, unknown>, string][] = [
    [
      "unbekannte Kategorie",
      proposal([{ ...business("2026-10-12", "13:00", "17:00"), kind: "duty" as never }]),
      "blocks.0.kind",
    ],
    [
      "zu langer Text",
      proposal([{ ...business("2026-10-12", "13:00", "17:00"), title: "x".repeat(61) }]),
      "blocks.0.title",
    ],
    [
      "Zeit außerhalb der Woche",
      proposal([...proposal().blocks, business("2026-10-19", "13:00", "14:00")]),
      "außerhalb der geplanten Woche",
    ],
    [
      "Überschneidung mit dem Dienst",
      proposal([...proposal().blocks.slice(1), business("2026-10-12", "10:00", "14:00")]),
      "überschneidet",
    ],
    [
      "Gewerbe-Minimum unterschritten",
      proposal(proposal().blocks.filter((b) => b.date !== "2026-10-16" || b.kind !== "business")),
      "Gewerbe-Minimum nicht erreicht",
    ],
    [
      "Pflicht-Training fehlt",
      proposal(proposal().blocks.filter((b) => b.kind !== "sport")),
      "Verbindlicher Block fehlt",
    ],
    [
      "Dienst geändert (feste Termine plant nur der Server)",
      proposal([
        ...proposal().blocks,
        { ...business("2026-10-12", "08:00", "12:00"), kind: "duty" as never },
      ]),
      "kind",
    ],
  ];

  it.each(rejected)(
    "%s → zweimal abgelehnt, nichts gespeichert",
    async (_name, answer, expected) => {
      const { requester, calls } = requesterReturning(answer);
      const { result, save } = await run(context(), requester);
      expect(result.status).toBe("failed");
      if (result.status === "failed") {
        expect(result.message).toContain("Es wurde nichts gespeichert");
        expect(result.details.join(" ")).toContain(expected);
      }
      expect(calls).toHaveLength(2);
      expect(save).not.toHaveBeenCalled();
      expectCleanLogs();
    },
  );

  it("Zeitüberschreitung und API-Fehler → verständlicher Fehler ohne zweiten Versuch", async () => {
    for (const error of [
      new PlannerModelError("timeout"),
      new PlannerModelError("auth", 401),
      new PlannerModelError("unavailable", 529),
    ]) {
      const { requester, calls } = requesterReturning(error);
      const { result, save } = await run(context(), requester);
      expect(result).toEqual({ status: "failed", message: error.message, details: [] });
      expect(calls).toHaveLength(1);
      expect(save).not.toHaveBeenCalled();
    }
    expectCleanLogs();
  });

  it("geänderter Entwurf beim Speichern (TT008) → nichts überschrieben, klare Meldung", async () => {
    const { requester } = requesterReturning(proposal());
    const result = await runPlanning({
      context: context(),
      requester,
      signal: new AbortController().signal,
      save: async () => {
        throw new UserFacingError("Der Entwurf wurde inzwischen geändert.");
      },
    });
    expect(result).toEqual({
      status: "failed",
      message: "Der Entwurf wurde inzwischen geändert.",
      details: [],
    });
  });

  it("Texte aus der Datenbank gehen nie an Claude (Prompt-Injection bleibt Daten)", async () => {
    const ctx = context({
      commitments: [
        ...([1, 2, 3, 4] as const).map((d) => commitment(d, "08:00", "12:00")),
        commitment(5, "08:00", "12:00", INJECTION, `${INJECTION} – Notiz`),
      ],
    });
    const { requester, calls } = requesterReturning(proposal());
    const { result, save } = await run(ctx, requester);
    expect(result.status).toBe("succeeded");
    const sent = buildPlannerUserMessage(calls[0]!.input) + PLANNER_SYSTEM_PROMPT;
    for (const forbidden of [
      INJECTION,
      "Ort (Beispiel)",
      "Training (Beispiel)",
      "Zeit zu zweit (Beispiel)",
      "00000000-0000-4000-8000",
      OWNER,
    ]) {
      expect(sent).not.toContain(forbidden);
    }
    expect(sent).toContain("Beziehungszeit");
    // Der Dienst wird unverändert (mit seinem Titel) übernommen, aber nie ausgeführt.
    const [entries] = save.mock.calls[0] as unknown as [{ title: string }[]];
    expect(entries.some((e) => e.title === INJECTION)).toBe(true);
    expectCleanLogs();
  });

  it("Planungshinweis enthält nur bereinigten Klartext", () => {
    const note = buildPlanningNote({
      ...proposal(),
      summary: "Zeile 1\n<script>alert(1)</script>\u0007",
      warnings: ["Hinweis\tmit Tab"],
    });
    expect(note).not.toContain("\u0007");
    expect(note.split("\n")).toContain("– Hinweis mit Tab");
    expect(note).toContain("Zeile 1 <script>alert(1)</script>");
  });
});
