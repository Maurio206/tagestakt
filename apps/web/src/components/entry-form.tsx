"use client";

import { CATEGORY_LABELS, ENTRY_CATEGORIES } from "@tagestakt/schedule-schema";
import Link from "next/link";
import { useActionState } from "react";

import { type ActionState, initialActionState } from "@/lib/form";

import { Field, FormMessage, SubmitButton, fieldProps } from "./ui";

export interface EntryFormDefaults {
  title: string;
  category: string;
  date: string;
  startTime: string;
  endTime: string;
  endsNextDay: boolean;
  location: string;
  note: string;
}

export function EntryForm({
  action,
  days,
  defaults,
  submitLabel,
  idPrefix,
  cancelHref,
}: {
  action: (state: ActionState, formData: FormData) => Promise<ActionState>;
  days: { value: string; label: string }[];
  defaults: EntryFormDefaults;
  submitLabel: string;
  idPrefix: string;
  cancelHref?: string;
}) {
  const [state, formAction] = useActionState(action, initialActionState);
  // Nach einem Fehler neu mounten, damit auch <select>/Radio-Felder die Eingaben behalten
  // (React setzt Formulare nach einer Action sonst auf die ursprünglichen Defaults zurück).
  const formKey = state.status === "error" ? JSON.stringify(state.values ?? {}) : "standard";
  const v = (name: keyof EntryFormDefaults) =>
    state.status === "error" && state.values ? (state.values[name] ?? "") : String(defaults[name]);
  const id = (name: string) => `${idPrefix}-${name}`;
  const endsNextDay =
    state.status === "error" && state.values
      ? state.values.endsNextDay === "on"
      : defaults.endsNextDay;

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
        <Field label="Tag" id={id("date")} name="date" state={state}>
          <select {...fieldProps(state, id("date"), "date")} defaultValue={v("date")}>
            {days.map((day) => (
              <option key={day.value} value={day.value}>
                {day.label}
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
        <Field label="Ende" id={id("endTime")} name="endTime" state={state}>
          <input
            {...fieldProps(state, id("endTime"), "endTime")}
            type="time"
            required
            defaultValue={v("endTime")}
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
