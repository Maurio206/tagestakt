"use client";

import { type ComponentProps, type MouseEvent, type ReactNode } from "react";
import { useFormStatus } from "react-dom";

import { type ActionState } from "@/lib/form";

/** Absende-Button mit Ladezustand. */
export function SubmitButton({
  children,
  pendingLabel = "Wird gespeichert …",
  variant = "primary",
  confirmMessage,
  ...rest
}: ComponentProps<"button"> & {
  pendingLabel?: string;
  variant?: "primary" | "secondary" | "danger" | "ghost";
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
      className={`button button--${variant} ${rest.className ?? ""}`}
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
    <p
      className={`notice notice--${state.status === "error" ? "error" : "success"}`}
      role={state.status === "error" ? "alert" : "status"}
    >
      {state.message}
    </p>
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
}: {
  label: string;
  id: string;
  name: string;
  state: ActionState;
  children: ReactNode;
  hint?: string;
}) {
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {children}
      {hint ? <p className="field-hint">{hint}</p> : null}
      <FieldError state={state} name={name} id={id} />
    </div>
  );
}

/** id, name und aria-Attribute für ein Formularfeld. */
export function fieldProps(state: ActionState, id: string, name: string) {
  const invalid = Boolean(state.fieldErrors?.[name]?.length);
  return {
    id,
    name,
    ...(invalid ? { "aria-invalid": true as const, "aria-describedby": `${id}-error` } : {}),
  };
}
