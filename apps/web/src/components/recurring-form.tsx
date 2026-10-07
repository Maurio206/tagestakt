"use client";

import {
  CATEGORY_LABELS,
  ENTRY_CATEGORIES,
  ISO_WEEKDAYS,
  WEEKDAY_LABELS,
  WEEKDAY_SHORT_LABELS,
} from "@tagestakt/schedule-schema";
import Link from "next/link";
import { useActionState } from "react";

import { type ActionState, initialActionState } from "@/lib/form";

import { Field, FieldError, FormMessage, SubmitButton, fieldProps } from "./ui";

export interface RecurringFormDefaults {
  title: string;
  category: string;
  /** Bearbeiten: ein Wochentag. Neu anlegen: kommagetrennte Liste (z. B. „1,2,3,4,5“). */
  weekday: string;
  startTime: string;
  endTime: string;
  location: string;
  note: string;
  active: boolean;
}

export function RecurringForm({
  action,
  defaults,
  submitLabel,
  idPrefix,
  cancelHref,
  multipleWeekdays = false,
}: {
  action: (state: ActionState, formData: FormData) => Promise<ActionState>;
  defaults: RecurringFormDefaults;
  submitLabel: string;
  idPrefix: string;
  cancelHref?: string;
  /** Neue Wiederholung für mehrere Wochentage auf einmal anlegen. */
  multipleWeekdays?: boolean;
}) {
  const [state, formAction] = useActionState(action, initialActionState);
  // Nach einem Fehler neu mounten, damit auch <select>/Radio-Felder die Eingaben behalten
  // (React setzt Formulare nach einer Action sonst auf die ursprünglichen Defaults zurück).
  const formKey = state.status === "error" ? JSON.stringify(state.values ?? {}) : "standard";
  const v = (name: keyof RecurringFormDefaults) =>
    state.status === "error" && state.values ? (state.values[name] ?? "") : String(defaults[name]);
  const id = (name: string) => `${idPrefix}-${name}`;
  const active =
    state.status === "error" && state.values ? state.values.active === "on" : defaults.active;
  const selectedDays = new Set(
    (state.status === "error" && state.values ? (state.values.weekdays ?? "") : defaults.weekday)
      .split(",")
      .filter(Boolean),
  );

  return (
    <form key={formKey} action={formAction} className="entry-form" noValidate>
      <FormMessage state={state} />
      <div className="form-grid">
        <Field label="Titel" id={id("title")} name="title" state={state}>
          <input
            {...fieldProps(state, id("title"), "title")}
            required
            maxLength={120}
            defaultValue={v("title")}
          />
        </Field>
        <Field label="Kategorie" id={id("category")} name="category" state={state}>
          <select {...fieldProps(state, id("category"), "category")} defaultValue={v("category")}>
            {ENTRY_CATEGORIES.map((category) => (
              <option key={category} value={category}>
                {CATEGORY_LABELS[category]}
              </option>
            ))}
          </select>
        </Field>
        {multipleWeekdays ? (
          <fieldset
            className="field field--wide"
            aria-describedby={state.fieldErrors?.weekdays ? id("weekdays-error") : undefined}
          >
            <legend>Wochentage</legend>
            <div className="choice-row">
              {ISO_WEEKDAYS.map((weekday) => (
                <label key={weekday} className="choice">
                  <input
                    type="checkbox"
                    name="weekdays"
                    value={weekday}
                    defaultChecked={selectedDays.has(String(weekday))}
                    aria-label={WEEKDAY_LABELS[weekday]}
                  />
                  <span aria-hidden="true">{WEEKDAY_SHORT_LABELS[weekday]}</span>
                </label>
              ))}
            </div>
            <div className="check">
              <input type="checkbox" id={id("workdays")} name="workdays" />
              <label htmlFor={id("workdays")}>Werktage (Montag bis Freitag)</label>
            </div>
            <FieldError state={state} name="weekdays" id={id("weekdays")} />
          </fieldset>
        ) : (
          <Field label="Wochentag" id={id("weekday")} name="weekday" state={state}>
            <select {...fieldProps(state, id("weekday"), "weekday")} defaultValue={v("weekday")}>
              {ISO_WEEKDAYS.map((weekday) => (
                <option key={weekday} value={weekday}>
                  {WEEKDAY_LABELS[weekday]}
                </option>
              ))}
            </select>
          </Field>
        )}
        <Field label="Beginn" id={id("startTime")} name="startTime" state={state}>
          <input
            {...fieldProps(state, id("startTime"), "startTime")}
            type="time"
            required
            defaultValue={v("startTime")}
          />
        </Field>
        <Field
          label="Ende"
          id={id("endTime")}
          name="endTime"
          state={state}
          hint="Liegt das Ende vor dem Beginn, endet der Block am Folgetag."
        >
          <input
            {...fieldProps(state, id("endTime"), "endTime")}
            type="time"
            required
            defaultValue={v("endTime")}
          />
        </Field>
        <Field label="Ort (optional)" id={id("location")} name="location" state={state}>
          <input
            {...fieldProps(state, id("location"), "location")}
            maxLength={120}
            defaultValue={v("location")}
          />
        </Field>
        <Field label="Notiz (optional)" id={id("note")} name="note" state={state} wide>
          <textarea
            {...fieldProps(state, id("note"), "note")}
            rows={2}
            maxLength={1000}
            defaultValue={v("note")}
          />
        </Field>
        <div className="check">
          <input id={id("active")} name="active" type="checkbox" defaultChecked={active} />
          <label htmlFor={id("active")}>Aktiv</label>
        </div>
      </div>
      <div className="button-row">
        <SubmitButton>{submitLabel}</SubmitButton>
        {cancelHref ? (
          <Link href={cancelHref} className="btn btn--ghost">
            Abbrechen
          </Link>
        ) : null}
      </div>
    </form>
  );
}
