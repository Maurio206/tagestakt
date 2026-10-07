import { describe, expect, it } from "vitest";

import {
  DAILY_NOTE_MAX_LENGTH,
  DAILY_NOTE_MESSAGES,
  type DailyNoteSnapshot,
  canSaveNote,
  countNoteCharacters,
  createNoteEditorState,
  dailyNoteRowSchema,
  dailyNoteSaveInputSchema,
  describeNoteStatus,
  isBlankNote,
  normalizeNoteContent,
  noteEditorReducer,
  notePreview,
  prepareNoteSave,
} from "./daily-notes";

const NOTE_ID = "6f9619ff-8b86-4d01-b42d-00c04fc964ff";
const saved: DailyNoteSnapshot = {
  id: NOTE_ID,
  revision: 1,
  content: "Material bereitlegen (Beispiel)",
  updatedAt: "2026-10-14T06:12:00.000Z",
};

function mustPrepare(state: Parameters<typeof prepareNoteSave>[0]) {
  const request = prepareNoteSave(state, "2026-10-14");
  if (!request) throw new Error("Speichern nicht möglich");
  return request;
}

describe("normalizeNoteContent", () => {
  it("vereinheitlicht Zeilenumbrüche, behält sie aber", () => {
    expect(normalizeNoteContent("Zeile 1\r\nZeile 2\rZeile 3\n\nZeile 5")).toBe(
      "Zeile 1\nZeile 2\nZeile 3\n\nZeile 5",
    );
  });

  it("entfernt Leerraum am Rand und Steuerzeichen, nicht aber Tabulatoren innen", () => {
    expect(normalizeNoteContent("  \n Text\tmit Tab\u0000\u0007 \n\n")).toBe("Text\tmit Tab");
  });

  it("normalisiert Unicode (NFC), damit gleiche Texte gleich gespeichert werden", () => {
    expect(normalizeNoteContent("Müsli")).toBe("Müsli");
  });

  it("lässt HTML als reinen Text stehen", () => {
    expect(normalizeNoteContent("<b>fett</b> & <script>x</script>")).toBe(
      "<b>fett</b> & <script>x</script>",
    );
  });

  it("erkennt leere und nur aus Leerraum bestehende Notizen", () => {
    expect(isBlankNote("")).toBe(true);
    expect(isBlankNote(" \n\t   ")).toBe(true);
    expect(isBlankNote(" a ")).toBe(false);
  });

  it("zählt Zeichen wie die Datenbank (Emoji = ein Zeichen)", () => {
    expect(countNoteCharacters("ä😀b")).toBe(3);
  });
});

describe("dailyNoteSaveInputSchema", () => {
  it("validiert das Datum strikt", () => {
    const base = { content: "x", expected: null };
    expect(dailyNoteSaveInputSchema.safeParse({ ...base, date: "2026-10-14" }).success).toBe(true);
    for (const date of ["2026-02-30", "2026-13-01", "14.10.2026", "2026-10-1", "1999-12-31", ""]) {
      expect(dailyNoteSaveInputSchema.safeParse({ ...base, date }).success, date).toBe(false);
    }
  });

  it("begrenzt die Länge auf 10 000 Zeichen (nach dem Normalisieren)", () => {
    const ok = dailyNoteSaveInputSchema.safeParse({
      date: "2026-10-14",
      content: `  ${"a".repeat(DAILY_NOTE_MAX_LENGTH)}  `,
      expected: null,
    });
    expect(ok.success).toBe(true);
    const tooLong = dailyNoteSaveInputSchema.safeParse({
      date: "2026-10-14",
      content: "a".repeat(DAILY_NOTE_MAX_LENGTH + 1),
      expected: null,
    });
    expect(tooLong.success).toBe(false);
    expect(tooLong.error?.issues[0]?.message).toBe(DAILY_NOTE_MESSAGES.tooLong);
  });

  it("verlangt einen vollständigen Bearbeitungsstand oder null", () => {
    const parse = (expected: unknown) =>
      dailyNoteSaveInputSchema.safeParse({ date: "2026-10-14", content: "x", expected }).success;
    expect(parse(null)).toBe(true);
    expect(parse({ id: NOTE_ID, revision: 2 })).toBe(true);
    expect(parse({ id: NOTE_ID })).toBe(false);
    expect(parse({ id: "kein-uuid", revision: 1 })).toBe(false);
    expect(parse({ id: NOTE_ID, revision: 0 })).toBe(false);
  });

  it("liest Datenbankzeilen", () => {
    const row = dailyNoteRowSchema.parse({
      id: NOTE_ID,
      owner_id: NOTE_ID,
      note_date: "2026-10-14",
      content: "Zeile 1\nZeile 2",
      revision: 3,
      created_at: "2026-10-14T06:00:00.123456+00:00",
      updated_at: "2026-10-14T06:12:00.123456+00:00",
    });
    expect(row.revision).toBe(3);
  });
});

describe("Editor-Zustand", () => {
  it("leer → geändert → speichert → gespeichert", () => {
    let state = createNoteEditorState(null);
    expect(describeNoteStatus(state).text).toBe("Noch keine Notiz für diesen Tag.");
    expect(canSaveNote(state)).toBe(false);

    state = noteEditorReducer(state, { type: "edit", text: "Neu (Beispiel)\n" });
    expect(state.status).toBe("dirty");
    expect(canSaveNote(state)).toBe(true);

    const request = mustPrepare(state);
    expect(request.input).toEqual({
      date: "2026-10-14",
      content: "Neu (Beispiel)",
      expected: null,
    });
    state = noteEditorReducer(state, {
      type: "save_started",
      requestId: request.requestId,
      content: request.input.content,
    });
    expect(state.status).toBe("saving");
    expect(canSaveNote(state)).toBe(false);
    expect(describeNoteStatus(state).text).toBe("Wird gespeichert …");

    state = noteEditorReducer(state, {
      type: "save_succeeded",
      requestId: request.requestId,
      note: { ...saved, content: "Neu (Beispiel)" },
      at: "2026-10-14T16:12:00.000Z",
    });
    expect(state.status).toBe("saved");
    expect(describeNoteStatus(state)).toEqual({
      tone: "success",
      text: "Gespeichert um 18:12 Uhr",
    });
    // Der Text im Feld wird nicht durch die Antwort ersetzt.
    expect(state.draft).toBe("Neu (Beispiel)\n");
  });

  it("Fehler: Text bleibt erhalten, erneutes Speichern wird angeboten", () => {
    let state = noteEditorReducer(createNoteEditorState(saved), { type: "edit", text: "Geändert" });
    const request = mustPrepare(state);
    expect(request.input.expected).toEqual({ id: NOTE_ID, revision: 1 });
    state = noteEditorReducer(state, {
      type: "save_started",
      requestId: request.requestId,
      content: request.input.content,
    });
    state = noteEditorReducer(state, {
      type: "save_failed",
      requestId: request.requestId,
      message: DAILY_NOTE_MESSAGES.offline,
    });
    expect(state.status).toBe("error");
    expect(state.draft).toBe("Geändert");
    expect(state.saved).toEqual(saved);
    expect(canSaveNote(state)).toBe(true);
    expect(describeNoteStatus(state)).toEqual({ tone: "error", text: DAILY_NOTE_MESSAGES.offline });
    expect(prepareNoteSave(state, "2026-10-14")?.requestId).toBe(request.requestId + 1);
  });

  it("Eingaben während des Speicherns gehen nicht verloren; alte Antworten überschreiben nichts", () => {
    let state = noteEditorReducer(createNoteEditorState(saved), {
      type: "edit",
      text: "Fassung 1",
    });
    const first = mustPrepare(state);
    state = noteEditorReducer(state, {
      type: "save_started",
      requestId: first.requestId,
      content: first.input.content,
    });
    state = noteEditorReducer(state, { type: "edit", text: "Fassung 2" });
    expect(state.status).toBe("saving");
    // Antwort einer unbekannten (älteren) Anfrage wird ignoriert.
    expect(
      noteEditorReducer(state, {
        type: "save_succeeded",
        requestId: first.requestId - 1,
        note: null,
        at: "2026-10-14T16:00:00.000Z",
      }),
    ).toBe(state);
    state = noteEditorReducer(state, {
      type: "save_succeeded",
      requestId: first.requestId,
      note: { ...saved, revision: 2, content: "Fassung 1" },
      at: "2026-10-14T16:01:00.000Z",
    });
    expect(state.draft).toBe("Fassung 2");
    expect(state.status).toBe("dirty");
    const second = mustPrepare(state);
    expect(second.input).toMatchObject({
      content: "Fassung 2",
      expected: { id: NOTE_ID, revision: 2 },
    });
  });

  it("Konflikt: eigene Fassung bleibt, Benutzer entscheidet", () => {
    let state = noteEditorReducer(createNoteEditorState(saved), { type: "edit", text: "Meins" });
    const request = mustPrepare(state);
    state = noteEditorReducer(state, {
      type: "save_started",
      requestId: request.requestId,
      content: request.input.content,
    });
    const latest = { ...saved, revision: 4, content: "Anderswo geändert" };
    state = noteEditorReducer(state, {
      type: "save_conflict",
      requestId: request.requestId,
      latest,
    });
    expect(state.status).toBe("conflict");
    expect(state.draft).toBe("Meins");
    expect(canSaveNote(state)).toBe(false);
    expect(describeNoteStatus(state).tone).toBe("warning");

    const kept = noteEditorReducer(state, { type: "keep_mine" });
    expect(kept.draft).toBe("Meins");
    expect(prepareNoteSave(kept, "2026-10-14")?.input.expected).toEqual({
      id: NOTE_ID,
      revision: 4,
    });

    const replaced = noteEditorReducer(state, { type: "use_latest" });
    expect(replaced.draft).toBe("Anderswo geändert");
    expect(replaced.status).toBe("idle");
  });

  it("„Konflikt“ mit genau dem eigenen Text gilt als gespeichert (verlorene Antwort)", () => {
    let state = noteEditorReducer(createNoteEditorState(saved), { type: "edit", text: "Neu " });
    const request = mustPrepare(state);
    state = noteEditorReducer(state, {
      type: "save_started",
      requestId: request.requestId,
      content: request.input.content,
    });
    const mine = { ...saved, revision: 2, content: "Neu", updatedAt: "2026-10-14T07:00:00.000Z" };
    state = noteEditorReducer(state, {
      type: "save_conflict",
      requestId: request.requestId,
      latest: mine,
    });
    expect(state.status).toBe("saved");
    expect(state.saved).toEqual(mine);
    expect(state.conflict).toBeNull();

    // Ebenso: Entfernen, und auf dem Server gibt es die Notiz schon nicht mehr.
    let removing = noteEditorReducer(createNoteEditorState(saved), { type: "edit", text: "" });
    const remove = mustPrepare(removing);
    removing = noteEditorReducer(removing, {
      type: "save_started",
      requestId: remove.requestId,
      content: remove.input.content,
    });
    removing = noteEditorReducer(removing, {
      type: "save_conflict",
      requestId: remove.requestId,
      latest: null,
    });
    expect(removing.status).toBe("saved");
    expect(removing.saved).toBeNull();
  });

  it("eine ältere Fassung vom Server ersetzt nie eine neuere (verspätete Abfrage)", () => {
    const newer = { ...saved, revision: 3, content: "Neuere Fassung" };
    const state = createNoteEditorState(newer);
    expect(noteEditorReducer(state, { type: "server_update", note: saved })).toBe(state);
  });

  it("leerer Inhalt entfernt die Notiz", () => {
    let state = noteEditorReducer(createNoteEditorState(saved), { type: "edit", text: "  \n " });
    const request = mustPrepare(state);
    expect(request.input.content).toBe("");
    state = noteEditorReducer(state, {
      type: "save_started",
      requestId: request.requestId,
      content: "",
    });
    state = noteEditorReducer(state, {
      type: "save_succeeded",
      requestId: request.requestId,
      note: null,
      at: "2026-10-14T16:00:00.000Z",
    });
    expect(state.saved).toBeNull();
    expect(describeNoteStatus(state).text).toBe("Notiz entfernt.");
  });

  it("zu lange Notizen lassen sich nicht speichern und werden benannt", () => {
    const state = noteEditorReducer(createNoteEditorState(null), {
      type: "edit",
      text: "a".repeat(DAILY_NOTE_MAX_LENGTH + 1),
    });
    expect(canSaveNote(state)).toBe(false);
    expect(describeNoteStatus(state)).toEqual({ tone: "error", text: DAILY_NOTE_MESSAGES.tooLong });
  });

  it("neuer Serverstand wird nur übernommen, wenn nichts Ungespeichertes verloren geht", () => {
    const clean = createNoteEditorState(saved);
    const newer = { ...saved, revision: 2, content: "Neuer Stand" };
    expect(noteEditorReducer(clean, { type: "server_update", note: newer }).draft).toBe(
      "Neuer Stand",
    );
    const dirty = noteEditorReducer(clean, { type: "edit", text: "Ungespeichert" });
    expect(noteEditorReducer(dirty, { type: "server_update", note: newer })).toBe(dirty);
  });

  it("derselbe Serverstand ersetzt den Entwurf nicht (z. B. Leerzeichen am Ende beim Tippen)", () => {
    const clean = createNoteEditorState(saved);
    // Ein Leerzeichen am Ende ist nach dem Normalisieren „nicht geändert“ – darf aber beim
    // erneuten Übermitteln derselben Fassung (gleiche Revision) nicht verschwinden.
    const typing = noteEditorReducer(clean, { type: "edit", text: `${saved.content} ` });
    const after = noteEditorReducer(typing, { type: "server_update", note: { ...saved } });
    expect(after).toBe(typing);
    expect(after.draft).toBe(`${saved.content} `);
    // Auch „keine Notiz“ → „keine Notiz“ lässt einen angefangenen Leerraum stehen.
    const empty = noteEditorReducer(createNoteEditorState(null), { type: "edit", text: "\n" });
    expect(noteEditorReducer(empty, { type: "server_update", note: null })).toBe(empty);
  });

  it("Statustexte enthalten nie den Notizinhalt", () => {
    const secret = "Geheimer Inhalt (Beispiel)";
    let state = noteEditorReducer(createNoteEditorState(null), { type: "edit", text: secret });
    const request = mustPrepare(state);
    state = noteEditorReducer(state, {
      type: "save_started",
      requestId: request.requestId,
      content: request.input.content,
    });
    for (const event of [
      {
        type: "save_failed" as const,
        requestId: request.requestId,
        message: DAILY_NOTE_MESSAGES.failed,
      },
      { type: "save_conflict" as const, requestId: request.requestId, latest: null },
    ]) {
      expect(describeNoteStatus(noteEditorReducer(state, event)).text).not.toContain(secret);
    }
  });
});

describe("notePreview", () => {
  it("zeigt die erste Zeile, gekürzt", () => {
    expect(notePreview("Erste Zeile\nZweite")).toBe("Erste Zeile");
    expect(notePreview("x".repeat(100), 10)).toBe(`${"x".repeat(9)}…`);
  });
});
