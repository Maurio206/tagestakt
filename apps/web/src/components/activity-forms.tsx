"use client";

import { GOAL_KEYS, GOAL_LABELS } from "@tagestakt/schedule-schema";
import Link from "next/link";
import { useActionState } from "react";

import { type ActionState, initialActionState } from "@/lib/form";

import { Field, FormMessage, SubmitButton, fieldProps, valueAfterError } from "./ui";

export interface ActivityTimeDefaults {
  date: string;
  startTime: string;
  /** Leer = läuft weiter (nur beim Korrigieren). */
  endTime: string;
  endsNextDay: boolean;
}

function TimeFields({
  state,
  idPrefix,
  defaults,
  allowRunning,
}: {
  state: ActionState;
  idPrefix: string;
  defaults: ActivityTimeDefaults;
  allowRunning: boolean;
}) {
  const id = (name: string) => `${idPrefix}-${name}`;
  const endsNextDay =
    state.status === "error" && state.values
      ? state.values.endsNextDay === "on"
      : defaults.endsNextDay;
  return (
    <>
      <Field label="Datum (Beginn)" id={id("date")} name="date" state={state}>
        <input
          {...fieldProps(state, id("date"), "date")}
          type="date"
          required
          defaultValue={valueAfterError(state, "date", defaults.date)}
        />
      </Field>
      <Field label="Beginn" id={id("startTime")} name="startTime" state={state}>
        <input
          {...fieldProps(state, id("startTime"), "startTime")}
          type="time"
          required
          defaultValue={valueAfterError(state, "startTime", defaults.startTime)}
        />
      </Field>
      <Field
        label={allowRunning ? "Ende (leer = läuft weiter)" : "Ende"}
        id={id("endTime")}
        name="endTime"
        state={state}
      >
        <input
          {...fieldProps(state, id("endTime"), "endTime")}
          type="time"
          required={!allowRunning}
          defaultValue={valueAfterError(state, "endTime", defaults.endTime)}
        />
      </Field>
      <div className="check">
        <input
          id={id("endsNextDay")}
          name="endsNextDay"
          type="checkbox"
          defaultChecked={endsNextDay}
        />
        <label htmlFor={id("endsNextDay")}>Endet am Folgetag</label>
      </div>
    </>
  );
}

/** „Zeit korrigieren“: Beginn und Ende einer Aktivität nachträglich ändern. */
export function ActivityCorrectionForm({
  action,
  sessionId,
  defaults,
  cancelHref,
  running,
}: {
  action: (state: ActionState, formData: FormData) => Promise<ActionState>;
  sessionId: string;
  defaults: ActivityTimeDefaults;
  cancelHref: string;
  running: boolean;
}) {
  const [state, formAction] = useActionState(action, initialActionState);
  const formKey = state.status === "error" ? JSON.stringify(state.values ?? {}) : "standard";
  return (
    <form key={formKey} action={formAction} className="stack" noValidate>
      <FormMessage state={state} />
      <input type="hidden" name="sessionId" value={sessionId} />
      <div className="form-grid">
        <TimeFields
          state={state}
          idPrefix={`korrektur-${sessionId}`}
          defaults={defaults}
          allowRunning={running}
        />
      </div>
      <p className="field-hint">
        Zeiten gelten in Europe/Berlin. Keine Zeiten in der Zukunft, höchstens 24 Stunden, keine
        Überschneidung mit anderen erfassten Aktivitäten. Die Aktivität wird als korrigiert
        gekennzeichnet.
      </p>
      <div className="button-row">
        <SubmitButton>Zeit speichern</SubmitButton>
        <Link href={cancelHref} className="btn btn--ghost">
          Abbrechen
        </Link>
      </div>
    </form>
  );
}

/** „Zeit nachtragen“: abgeschlossene Aktivität ohne Timer erfassen. */
export function ActivityManualForm({
  action,
  defaults,
}: {
  action: (state: ActionState, formData: FormData) => Promise<ActionState>;
  defaults: ActivityTimeDefaults & { goal: string; title: string };
}) {
  const [state, formAction] = useActionState(action, initialActionState);
  const formKey = state.status === "error" ? JSON.stringify(state.values ?? {}) : "standard";
  return (
    <form key={formKey} action={formAction} className="stack" noValidate>
      <FormMessage state={state} />
      <div className="form-grid">
        <Field label="Ziel" id="nachtrag-goal" name="goal" state={state}>
          <select
            {...fieldProps(state, "nachtrag-goal", "goal")}
            defaultValue={valueAfterError(state, "goal", defaults.goal)}
          >
            {GOAL_KEYS.map((goal) => (
              <option key={goal} value={goal}>
                {GOAL_LABELS[goal]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Titel" id="nachtrag-title" name="title" state={state}>
          <input
            {...fieldProps(state, "nachtrag-title", "title")}
            required
            maxLength={120}
            defaultValue={valueAfterError(state, "title", defaults.title)}
          />
        </Field>
        <TimeFields state={state} idPrefix="nachtrag" defaults={defaults} allowRunning={false} />
      </div>
      <div className="button-row">
        <SubmitButton>Zeit nachtragen</SubmitButton>
      </div>
    </form>
  );
}
