"use client";

import { useActionState } from "react";

import { type ActionState, initialActionState } from "@/lib/form";

import { Field, FormMessage, SubmitButton, fieldProps } from "./ui";

export function SettingsForm({
  action,
  defaultHours,
}: {
  action: (state: ActionState, formData: FormData) => Promise<ActionState>;
  defaultHours: string;
}) {
  const [state, formAction] = useActionState(action, initialActionState);
  return (
    <form action={formAction} className="stack" noValidate>
      <FormMessage state={state} />
      <Field
        label="Wochenziel Gewerbe (Stunden)"
        id="settings-target"
        name="weeklyBusinessTargetHours"
        state={state}
        hint="Standard: 20 Stunden. Dezimalwerte wie 17,5 sind möglich."
      >
        <input
          {...fieldProps(state, "settings-target", "weeklyBusinessTargetHours")}
          inputMode="decimal"
          required
          defaultValue={
            state.status === "error" && state.values
              ? (state.values.weeklyBusinessTargetHours ?? "")
              : defaultHours
          }
        />
      </Field>
      <SubmitButton>Wochenziel speichern</SubmitButton>
    </form>
  );
}
