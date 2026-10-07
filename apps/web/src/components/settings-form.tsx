"use client";

import {
  REMINDER_LEAD_OPTIONS,
  REMINDER_SCOPES,
  REMINDER_SCOPE_LABELS,
  type ReminderScope,
} from "@tagestakt/schedule-schema";
import { useActionState } from "react";

import { type ActionState, initialActionState } from "@/lib/form";

import { Field, FormMessage, SubmitButton, fieldProps, valueAfterError } from "./ui";

type Action = (state: ActionState, formData: FormData) => Promise<ActionState>;

/** Wochenziele in Stunden. Leer = kein Ziel (Sport, Laila); Gewerbe leer = 0. */
export function GoalSettingsForm({
  action,
  defaults,
}: {
  action: Action;
  defaults: { business: string; sport: string; relationship: string };
}) {
  const [state, formAction] = useActionState(action, initialActionState);
  const fields = [
    {
      name: "weeklyBusinessTargetHours",
      id: "ziel-gewerbe",
      label: "Gewerbe (Stunden pro Woche)",
      value: defaults.business,
      hint: "Standard: 20 Stunden.",
    },
    {
      name: "weeklySportTargetHours",
      id: "ziel-sport",
      label: "Sport (Stunden pro Woche)",
      value: defaults.sport,
      hint: "Leer lassen, wenn noch kein Ziel festgelegt ist.",
    },
    {
      name: "weeklyRelationshipTargetHours",
      id: "ziel-laila",
      label: "Laila (Stunden pro Woche)",
      value: defaults.relationship,
      hint: "Leer lassen, wenn noch kein Ziel festgelegt ist.",
    },
  ];
  return (
    <form action={formAction} className="stack" noValidate>
      <FormMessage state={state} />
      <div className="form-grid">
        {fields.map((field) => (
          <Field
            key={field.name}
            label={field.label}
            id={field.id}
            name={field.name}
            state={state}
            hint={field.hint}
          >
            <input
              {...fieldProps(state, field.id, field.name, true)}
              inputMode="decimal"
              placeholder="kein Ziel"
              defaultValue={valueAfterError(state, field.name, field.value)}
            />
          </Field>
        ))}
      </div>
      <p className="field-hint">Eingaben wie 20, 2,5 oder 1:30 sind möglich.</p>
      <div className="button-row">
        <SubmitButton>Wochenziele speichern</SubmitButton>
      </div>
    </form>
  );
}

/** Erinnerungen werden lokal in der App ausgelöst; hier nur die Vorgaben. */
export function ReminderSettingsForm({
  action,
  defaults,
}: {
  action: Action;
  defaults: {
    minutesBefore: number | null;
    atStart: boolean;
    ifNotStarted: boolean;
    scope: ReminderScope;
  };
}) {
  const [state, formAction] = useActionState(action, initialActionState);
  const formKey = state.status === "error" ? JSON.stringify(state.values ?? {}) : "standard";
  const afterError = state.status === "error" && state.values ? state.values : undefined;
  const leadOptions = [...new Set([...REMINDER_LEAD_OPTIONS, defaults.minutesBefore ?? 10])].sort(
    (a, b) => a - b,
  );
  return (
    <form key={formKey} action={formAction} className="stack" noValidate>
      <FormMessage state={state} />
      <div className="form-grid">
        <Field
          label="Vorab erinnern"
          id="erinnerung-vorlauf"
          name="reminderMinutesBefore"
          state={state}
        >
          <select
            {...fieldProps(state, "erinnerung-vorlauf", "reminderMinutesBefore")}
            defaultValue={afterError?.reminderMinutesBefore ?? String(defaults.minutesBefore ?? "")}
          >
            <option value="">Keine Vorab-Erinnerung</option>
            {leadOptions.map((minutes) => (
              <option key={minutes} value={minutes}>
                {minutes} Minuten vorher
              </option>
            ))}
          </select>
        </Field>
        <Field label="Für welche Blöcke" id="erinnerung-umfang" name="reminderScope" state={state}>
          <select
            {...fieldProps(state, "erinnerung-umfang", "reminderScope")}
            defaultValue={afterError?.reminderScope ?? defaults.scope}
          >
            {REMINDER_SCOPES.map((scope) => (
              <option key={scope} value={scope}>
                {REMINDER_SCOPE_LABELS[scope]}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <div className="check">
        <input
          id="erinnerung-beginn"
          name="remindAtStart"
          type="checkbox"
          defaultChecked={afterError ? afterError.remindAtStart === "on" : defaults.atStart}
        />
        <label htmlFor="erinnerung-beginn">Zum geplanten Beginn erinnern</label>
      </div>
      <div className="check">
        <input
          id="erinnerung-nicht-gestartet"
          name="remindIfNotStarted"
          type="checkbox"
          defaultChecked={
            afterError ? afterError.remindIfNotStarted === "on" : defaults.ifNotStarted
          }
        />
        <label htmlFor="erinnerung-nicht-gestartet">
          Erinnern, wenn ein Zielblock 10 Minuten nach Beginn noch nicht gestartet ist
        </label>
      </div>
      <div className="button-row">
        <SubmitButton>Erinnerungen speichern</SubmitButton>
      </div>
    </form>
  );
}
