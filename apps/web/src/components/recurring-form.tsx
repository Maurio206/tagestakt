"use client";

import {
  CATEGORY_LABELS,
  ENTRY_CATEGORIES,
  ISO_WEEKDAYS,
  WEEKDAY_LABELS,
} from "@tagestakt/schedule-schema";
import Link from "next/link";
import { useActionState } from "react";

import { type ActionState, initialActionState } from "@/lib/form";

import { Field, FormMessage, SubmitButton, fieldProps } from "./ui";

export interface RecurringFormDefaults {
  title: string;
  category: string;
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
}: {
  action: (state: ActionState, formData: FormData) => Promise<ActionState>;
  defaults: RecurringFormDefaults;
  submitLabel: string;
  idPrefix: string;
  cancelHref?: string;
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
        <Field label="Wochentag" id={id("weekday")} name="weekday" state={state}>
          <select {...fieldProps(state, id("weekday"), "weekday")} defaultValue={v("weekday")}>
            {ISO_WEEKDAYS.map((weekday) => (
              <option key={weekday} value={weekday}>
                {WEEKDAY_LABELS[weekday]}
              </option>
            ))}
          </select>
        </Field>
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
        <Field label="Notiz (optional)" id={id("note")} name="note" state={state}>
          <textarea
            {...fieldProps(state, id("note"), "note")}
            rows={2}
            maxLength={1000}
            defaultValue={v("note")}
          />
        </Field>
        <div className="field field--checkbox">
          <input id={id("active")} name="active" type="checkbox" defaultChecked={active} />
          <label htmlFor={id("active")}>Aktiv</label>
        </div>
      </div>
      <div className="button-row">
        <SubmitButton>{submitLabel}</SubmitButton>
        {cancelHref ? (
          <Link href={cancelHref} className="button button--ghost">
            Abbrechen
          </Link>
        ) : null}
      </div>
    </form>
  );
}
