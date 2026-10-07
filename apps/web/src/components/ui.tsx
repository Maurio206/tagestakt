"use client";

import { type ComponentProps, type MouseEvent, type ReactNode } from "react";
import { useFormStatus } from "react-dom";

import { type ActionState } from "@/lib/form";

import { Notice } from "./notice";

export type ButtonVariant = "primary" | "secondary" | "danger" | "ghost";

export function buttonClass(
  variant: ButtonVariant = "secondary",
  size: "md" | "lg" | "sm" = "md",
  extra = "",
): string {
  return ["btn", `btn--${variant}`, size === "md" ? "" : `btn--${size}`, extra]
    .filter(Boolean)
    .join(" ");
}

/** Absende-Button mit Ladezustand und optionaler Rückfrage. */
export function SubmitButton({
  children,
  pendingLabel = "Wird gespeichert …",
  variant = "primary",
  size = "md",
  confirmMessage,
  ...rest
}: ComponentProps<"button"> & {
  pendingLabel?: string;
  variant?: ButtonVariant;
  size?: "md" | "lg" | "sm";
  /** Fragt vor dem Absenden nach (z. B. Löschen, Veröffentlichen). */
  confirmMessage?: string;
}) {
  const { pending } = useFormStatus();
  const onClick = (event: MouseEvent<HTMLButtonElement>) => {
    if (confirmMessage && !window.confirm(confirmMessage)) {
      event.preventDefault();
      return;
    }
    rest.onClick?.(event);
  };
  return (
    <button
      type="submit"
      {...rest}
      onClick={onClick}
      className={buttonClass(variant, size, rest.className)}
      disabled={pending || rest.disabled}
      aria-busy={pending}
    >
      {pending ? pendingLabel : children}
    </button>
  );
}

export function FormMessage({ state }: { state: ActionState }) {
  if (state.status === "idle" || !state.message) return null;
  return (
    <Notice
      tone={state.status === "error" ? "error" : "success"}
      role={state.status === "error" ? "alert" : "status"}
    >
      {state.message}
    </Notice>
  );
}

export function FieldError({ state, name, id }: { state: ActionState; name: string; id: string }) {
  const messages = state.fieldErrors?.[name];
  if (!messages || messages.length === 0) return null;
  return (
    <p className="field-error" id={`${id}-error`}>
      {messages[0]}
    </p>
  );
}

export function Field({
  label,
  id,
  name,
  state,
  children,
  hint,
  wide = false,
}: {
  label: string;
  id: string;
  name: string;
  state: ActionState;
  children: ReactNode;
  hint?: string;
  wide?: boolean;
}) {
  return (
    <div className={wide ? "field field--wide" : "field"}>
      <label htmlFor={id}>{label}</label>
      {children}
      {hint ? (
        <p className="field-hint" id={`${id}-hint`}>
          {hint}
        </p>
      ) : null}
      <FieldError state={state} name={name} id={id} />
    </div>
  );
}

/** id, name und aria-Attribute für ein Formularfeld. */
export function fieldProps(state: ActionState, id: string, name: string, hasHint = false) {
  const invalid = Boolean(state.fieldErrors?.[name]?.length);
  const describedBy = [invalid ? `${id}-error` : "", hasHint ? `${id}-hint` : ""]
    .filter(Boolean)
    .join(" ");
  return {
    id,
    name,
    ...(invalid ? { "aria-invalid": true as const } : {}),
    ...(describedBy ? { "aria-describedby": describedBy } : {}),
  };
}

/** Wert eines Feldes: nach einem Fehler die Eingabe, sonst der Standardwert. */
export function valueAfterError(state: ActionState, name: string, fallback: string): string {
  return state.status === "error" && state.values ? (state.values[name] ?? "") : fallback;
}
