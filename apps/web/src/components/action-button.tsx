"use client";

import { useActionState } from "react";

import { type ActionState, initialActionState } from "@/lib/form";

import { FormMessage, SubmitButton } from "./ui";

/** Einzelner Aktionsknopf (z. B. Löschen, Veröffentlichen) mit Rückfrage und Fehleranzeige. */
export function ActionButton({
  action,
  label,
  pendingLabel,
  confirmMessage,
  variant = "secondary",
  ariaLabel,
}: {
  action: (state: ActionState, formData: FormData) => Promise<ActionState>;
  label: string;
  pendingLabel?: string;
  confirmMessage?: string;
  variant?: "primary" | "secondary" | "danger" | "ghost";
  ariaLabel?: string;
}) {
  const [state, formAction] = useActionState(action, initialActionState);
  return (
    <form action={formAction} className="inline-form">
      <SubmitButton
        variant={variant}
        pendingLabel={pendingLabel ?? "Bitte warten …"}
        confirmMessage={confirmMessage}
        aria-label={ariaLabel}
      >
        {label}
      </SubmitButton>
      {state.status === "error" ? <FormMessage state={state} /> : null}
    </form>
  );
}
