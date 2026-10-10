/**
 * Abgleich beim Speichern eines Vorschlags (ohne Datenbank): Unverändertes bleibt mit ID und
 * Erledigt-Status, ersetzt wird nur Geplantes ab dem frühesten Beginn. Alle Daten sind frei
 * erfunden (Beispiel).
 */
import { type ScheduleEntry } from "@tagestakt/schedule-schema";
import { describe, expect, it } from "vitest";

import { LockedEntryChangeError, planDraftWrite } from "./planning-data";

const CUTOFF = Date.parse("2026-10-14T08:15:00Z");
let nextId = 0;

function row(start: string, end: string, overrides: Partial<ScheduleEntry> = {}): ScheduleEntry {
  nextId += 1;
  return {
    id: `00000000-0000-4000-8000-${String(nextId).padStart(12, "0")}`,
    owner_id: "11111111-1111-4111-8111-111111111111",
    schedule_week_id: "22222222-2222-4222-8222-222222222222",
    title: "Dienst (Beispiel)",
    category: "duty",
    start_at: start,
    end_at: end,
    location: null,
    note: null,
    source: "recurring",
    completion_status: "planned",
    created_at: "2026-10-01T00:00:00Z",
    updated_at: "2026-10-01T00:00:00Z",
    ...overrides,
  };
}

const planned = (entry: ScheduleEntry, overrides: { end_at?: string; title?: string } = {}) => ({
  title: entry.title,
  category: entry.category,
  start_at: entry.start_at,
  end_at: entry.end_at,
  location: entry.location,
  note: entry.note,
  source: entry.source,
  ...overrides,
});

describe("planDraftWrite", () => {
  const past = row("2026-10-12T06:00:00.000Z", "2026-10-12T13:30:00.000Z", {
    completion_status: "completed",
  });
  const running = row("2026-10-14T06:00:00.000Z", "2026-10-14T13:30:00.000Z");
  const future = row("2026-10-15T06:00:00.000Z", "2026-10-15T13:30:00.000Z");
  const block = row("2026-10-15T14:00:00.000Z", "2026-10-15T16:00:00.000Z", {
    title: "Akquise (Beispiel)",
    category: "business",
    source: "agent",
  });
  const manual = row("2026-10-16T08:00:00.000Z", "2026-10-16T09:00:00.000Z", {
    title: "Einzeltermin (Beispiel)",
    category: "appointment",
    source: "manual",
  });
  const current = [past, running, future, block, manual];

  it("gleicher Stand: nichts zu tun", () => {
    expect(
      planDraftWrite(
        current,
        current.map((e) => planned(e)),
        CUTOFF,
        false,
      ),
    ).toEqual({ remove: [], endChanges: [], insert: [] });
  });

  it("Einzeltermin dieser Woche verschieben oder streichen (Inhalt bleibt erhalten)", () => {
    const withNote = row("2026-10-16T10:00:00.000Z", "2026-10-16T11:00:00.000Z", {
      title: "Einzeltermin (Beispiel)",
      category: "appointment",
      source: "manual",
      location: "Ort (Beispiel)",
      note: "Notiz (Beispiel)",
    });
    const rest = [past, running, future, block].map((e) => planned(e));
    const moved = planned(withNote, {});
    Object.assign(moved, {
      start_at: "2026-10-16T12:00:00.000Z",
      end_at: "2026-10-16T13:00:00.000Z",
    });
    expect(
      planDraftWrite([...current, withNote], [...rest, planned(manual), moved], CUTOFF, false),
    ).toEqual({ remove: [withNote.id], endChanges: [], insert: [moved] });
    expect(moved).toMatchObject({ source: "manual", location: "Ort (Beispiel)" });
    expect(planDraftWrite(current, rest, CUTOFF, false)).toEqual({
      remove: [manual.id],
      endChanges: [],
      insert: [],
    });
  });

  it("ersetzt nur Geplantes ab dem frühesten Beginn", () => {
    const moved = {
      ...planned(block),
      start_at: "2026-10-15T15:00:00.000Z",
      end_at: "2026-10-15T17:00:00.000Z",
    };
    expect(
      planDraftWrite(
        current,
        [planned(past), planned(running), planned(future), moved, planned(manual)],
        CUTOFF,
        false,
      ),
    ).toEqual({
      remove: [block.id],
      endChanges: [],
      insert: [moved],
    });
  });

  it("laufende Wiederholung: nur das Ende ändert sich, ID und Status bleiben", () => {
    const shorter = planned(running, { end_at: "2026-10-14T10:00:00.000Z" });
    expect(
      planDraftWrite(
        current,
        [planned(past), shorter, planned(future), planned(block), planned(manual)],
        CUTOFF,
        false,
      ),
    ).toEqual({
      remove: [],
      endChanges: [{ id: running.id, end_at: "2026-10-14T10:00:00.000Z" }],
      insert: [],
    });
  });

  it("laufender geplanter Block: ebenfalls nur das Ende", () => {
    const runningBlock = row("2026-10-14T07:00:00.000Z", "2026-10-14T10:00:00.000Z", {
      title: "Akquise (Beispiel)",
      category: "business",
      source: "agent",
      completion_status: "completed",
    });
    const later = planned(runningBlock, { end_at: "2026-10-14T11:00:00.000Z" });
    expect(planDraftWrite([runningBlock], [later], CUTOFF, false)).toEqual({
      remove: [],
      endChanges: [{ id: runningBlock.id, end_at: "2026-10-14T11:00:00.000Z" }],
      insert: [],
    });
  });

  it("Begonnenes wird nie entfernt, umbenannt oder nachträglich angelegt", () => {
    expect(() =>
      planDraftWrite(current, [planned(running), planned(future), planned(block)], CUTOFF, false),
    ).toThrow(LockedEntryChangeError);
    expect(() =>
      planDraftWrite(
        current,
        [
          planned(past, { title: "Anders (Beispiel)" }),
          planned(running),
          planned(future),
          planned(block),
        ],
        CUTOFF,
        false,
      ),
    ).toThrow(LockedEntryChangeError);
    const extraPast = {
      ...planned(past),
      start_at: "2026-10-13T06:00:00.000Z",
      end_at: "2026-10-13T07:00:00.000Z",
    };
    expect(() =>
      planDraftWrite(
        current,
        [...[past, running, future, block].map((e) => planned(e)), extraPast],
        CUTOFF,
        false,
      ),
    ).toThrow(LockedEntryChangeError);
  });

  it("Woche ohne Version: Vergangenes aus den Wiederholungen wird erstmals angelegt", () => {
    const desired = [past, running, future].map((e) => planned(e));
    expect(planDraftWrite([], desired, CUTOFF, true)).toEqual({
      remove: [],
      endChanges: [],
      insert: desired,
    });
  });

  it("gleiche Einträge mehrfach werden einzeln abgeglichen", () => {
    const twin = row(block.start_at, block.end_at, {
      title: block.title,
      category: "business",
      source: "agent",
    });
    expect(planDraftWrite([block, twin], [planned(block)], CUTOFF, false)).toEqual({
      remove: [twin.id],
      endChanges: [],
      insert: [],
    });
  });
});
