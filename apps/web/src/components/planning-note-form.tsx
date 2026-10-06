"use client";

import { useActionState } from "react";

import { type ActionState, initialActionState } from "@/lib/form";

import { Field, FormMessage, SubmitButton, fieldProps } from "./ui";

export function PlanningNoteForm({
  action,
  defaultNote,
}: {
  action: (state: ActionState, formData: FormData) => Promise<ActionState>;
  defaultNote: string;
}) {
  const [state, formAction] = useActionState(action, initialActionState);
  return (
    <form action={formAction} className="stack" noValidate>
      <FormMessage state={state} />
      <Field
        label="Planungshinweis (optional)"
        id="planning-note"
        name="planningNote"
        state={state}
      >
        <textarea
          {...fieldProps(state, "planning-note", "planningNote")}
          rows={2}
          maxLength={2000}
          defaultValue={
            state.status === "error" && state.values
              ? (state.values.planningNote ?? "")
              : defaultNote
          }
        />
      </Field>
      <SubmitButton variant="secondary">Entwurf speichern</SubmitButton>
    </form>
  );
}
