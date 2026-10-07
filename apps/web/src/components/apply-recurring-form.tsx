"use client";

import { useActionState } from "react";

import { type ActionState, initialActionState } from "@/lib/form";

import { Field, FieldError, FormMessage, SubmitButton, fieldProps } from "./ui";

/**
 * Übernahme der Wiederholungen in einen Wochenentwurf. Die Bestätigung ist
 * Pflicht, sobald bereits Einträge existieren – das prüft der Server.
 */
export function ApplyRecurringForm({
  action,
  defaultWeek,
}: {
  action: (state: ActionState, formData: FormData) => Promise<ActionState>;
  defaultWeek: string;
}) {
  const [state, formAction] = useActionState(action, initialActionState);
  // Nach einem Fehler neu mounten, damit auch <select>/Radio-Felder die Eingaben behalten
  // (React setzt Formulare nach einer Action sonst auf die ursprünglichen Defaults zurück).
  const formKey = state.status === "error" ? JSON.stringify(state.values ?? {}) : "standard";
  const values = state.status === "error" ? state.values : undefined;
  const mode = values?.mode ?? "append";

  return (
    <form key={formKey} action={formAction} className="stack" noValidate>
      <FormMessage state={state} />
      <Field
        label="Woche (beliebiger Tag)"
        id="apply-week"
        name="week"
        state={state}
        hint="Es wird immer die Woche ab Montag verwendet."
      >
        <input
          {...fieldProps(state, "apply-week", "week")}
          type="date"
          required
          defaultValue={values?.week ?? defaultWeek}
        />
      </Field>
      <fieldset className="stack-tight">
        <legend>Vorhandene Einträge im Entwurf</legend>
        <div className="check">
          <input
            type="radio"
            id="apply-mode-append"
            name="mode"
            value="append"
            defaultChecked={mode === "append"}
          />
          <label htmlFor="apply-mode-append">
            Ergänzen (identische Einträge werden übersprungen)
          </label>
        </div>
        <div className="check">
          <input
            type="radio"
            id="apply-mode-replace"
            name="mode"
            value="replace"
            defaultChecked={mode === "replace"}
          />
          <label htmlFor="apply-mode-replace">
            Ersetzen (alle Einträge des Entwurfs werden entfernt)
          </label>
        </div>
      </fieldset>
      <div className="check">
        <input
          type="checkbox"
          id="apply-confirm"
          name="confirmed"
          {...(state.fieldErrors?.confirmed
            ? { "aria-invalid": true, "aria-describedby": "apply-confirm-error" }
            : {})}
        />
        <label htmlFor="apply-confirm">
          Ich bestätige die Übernahme in den Entwurf dieser Woche. Eine veröffentlichte Version
          bleibt unverändert.
        </label>
      </div>
      <FieldError state={state} name="confirmed" id="apply-confirm" />
      <SubmitButton pendingLabel="Wird übernommen …">In Wochenentwurf übernehmen</SubmitButton>
    </form>
  );
}
