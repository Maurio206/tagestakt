"use client";

import { useActionState } from "react";

import { type ActionState, initialActionState } from "@/lib/form";

import { Field, FormMessage, SubmitButton, fieldProps } from "./ui";

export function LoginForm({
  action,
  returnPath = null,
}: {
  action: (state: ActionState, formData: FormData) => Promise<ActionState>;
  /** Geprüfter Rücksprung (nur Connector-Freigabe); der Server prüft ihn erneut. */
  returnPath?: string | null;
}) {
  const [state, formAction] = useActionState(action, initialActionState);
  return (
    <form action={formAction} className="stack" noValidate>
      {returnPath ? <input type="hidden" name="weiter" value={returnPath} /> : null}
      <FormMessage state={state} />
      <Field label="E-Mail" id="login-email" name="email" state={state}>
        <input
          {...fieldProps(state, "login-email", "email")}
          type="email"
          autoComplete="username"
          inputMode="email"
          required
          defaultValue={state.values?.email ?? ""}
        />
      </Field>
      <Field label="Passwort" id="login-password" name="password" state={state}>
        <input
          {...fieldProps(state, "login-password", "password")}
          type="password"
          autoComplete="current-password"
          required
        />
      </Field>
      <SubmitButton pendingLabel="Anmeldung läuft …" size="lg" className="btn--block">
        Anmelden
      </SubmitButton>
    </form>
  );
}
