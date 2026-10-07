"use client";

import { type ReactNode, useActionState } from "react";

import { type ActionState, initialActionState } from "@/lib/form";

import { type ButtonVariant, FormMessage, SubmitButton } from "./ui";

/** Einzelner Aktionsknopf (z. B. Löschen, Veröffentlichen) mit Rückfrage und Fehleranzeige. */
export function ActionButton({
  action,
  label,
  icon,
  pendingLabel,
  confirmMessage,
  variant = "secondary",
  size = "md",
  ariaLabel,
  disabled,
}: {
  action: (state: ActionState, formData: FormData) => Promise<ActionState>;
  label: string;
  icon?: ReactNode;
  pendingLabel?: string;
  confirmMessage?: string;
  variant?: ButtonVariant;
  size?: "md" | "lg" | "sm";
  ariaLabel?: string;
  disabled?: boolean;
}) {
  const [state, formAction] = useActionState(action, initialActionState);
  return (
    <form action={formAction} className="inline-form">
      <SubmitButton
        variant={variant}
        size={size}
        pendingLabel={pendingLabel ?? "Bitte warten …"}
        confirmMessage={confirmMessage}
        aria-label={ariaLabel}
        disabled={disabled}
      >
        {icon}
        {label}
      </SubmitButton>
      {state.status === "error" ? <FormMessage state={state} /> : null}
    </form>
  );
}
