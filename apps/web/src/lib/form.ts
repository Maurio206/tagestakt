import { z } from "zod";

export type FieldErrors = Partial<Record<string, string[]>>;

/** Gemeinsamer Rückgabewert aller Server Actions mit Formular. */
export interface ActionState {
  status: "idle" | "success" | "error";
  message?: string;
  fieldErrors?: FieldErrors;
  /** Eingaben zum Wiederbefüllen nach einem Fehler (niemals Passwörter). */
  values?: Record<string, string>;
}

export const initialActionState: ActionState = { status: "idle" };

/** Alle Textfelder eines Formulars; Dateien und interne Next.js-Felder werden ignoriert. */
export function formValues(
  formData: FormData,
  omit: readonly string[] = [],
): Record<string, string> {
  const values: Record<string, string> = {};
  for (const [key, value] of formData.entries()) {
    if (typeof value === "string" && !key.startsWith("$ACTION") && !omit.includes(key)) {
      values[key] = value;
    }
  }
  return values;
}

export function readCheckbox(formData: FormData, name: string): boolean {
  const value = formData.get(name);
  return value === "on" || value === "true" || value === "1";
}

export function readString(formData: FormData, name: string): string | undefined {
  const value = formData.get(name);
  return typeof value === "string" ? value : undefined;
}

export function fieldErrorsFrom(error: z.ZodError): FieldErrors {
  return z.flattenError(error).fieldErrors as FieldErrors;
}

export function validationError(error: z.ZodError, values: Record<string, string>): ActionState {
  return {
    status: "error",
    message: "Bitte die markierten Felder prüfen.",
    fieldErrors: fieldErrorsFrom(error),
    values,
  };
}

/** Server Action mit Formularzustand (für `useActionState`). Komponenten erhalten sie als Prop. */
export type FormAction = (state: ActionState, formData: FormData) => Promise<ActionState>;
