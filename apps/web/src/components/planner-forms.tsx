"use client";

import { Sparkles, Upload } from "lucide-react";
import { useActionState } from "react";

import { type FormAction, initialActionState } from "@/lib/form";

import { FormMessage, SubmitButton } from "./ui";

/** Wörtliche Rückfrage unmittelbar vor dem Veröffentlichen. */
export const PUBLISH_QUESTION = "Soll dieser Wochenplan veröffentlicht werden?";

/**
 * „Woche mit Claude planen“ bzw. „Neu planen“. Ein vorhandener Entwurf wird nur ersetzt, wenn
 * der angezeigte Stand (Entwurf + Prüfstand) noch aktuell ist – das prüft der Server.
 */
export function PlanStartForm({
  action,
  draft,
  disabled,
}: {
  action: FormAction;
  draft: { id: string; fingerprint: string; version: number } | null;
  disabled?: boolean;
}) {
  const [state, formAction] = useActionState(action, initialActionState);
  return (
    <form action={formAction} className="stack-tight">
      {draft ? (
        <>
          <input type="hidden" name="entwurf" value={draft.id} />
          <input type="hidden" name="stand" value={draft.fingerprint} />
        </>
      ) : null}
      <div className="button-row">
        <SubmitButton
          variant={draft ? "secondary" : "primary"}
          size="lg"
          pendingLabel="Planung wird gestartet …"
          disabled={disabled}
          confirmMessage={
            draft
              ? `„Neu planen“ ersetzt Entwurf Version ${draft.version} vollständig, auch eigene Änderungen darin. Der veröffentlichte Plan bleibt unverändert. Fortfahren?`
              : undefined
          }
        >
          <Sparkles size={18} aria-hidden="true" />
          {draft ? "Neu planen" : "Woche mit Claude planen"}
        </SubmitButton>
      </div>
      <FormMessage state={state} />
    </form>
  );
}

/** Veröffentlicht genau den angezeigten Stand – nach ausdrücklicher Rückfrage. */
export function PublishPlanForm({
  action,
  fingerprint,
  disabled,
}: {
  action: FormAction;
  fingerprint: string;
  disabled?: boolean;
}) {
  const [state, formAction] = useActionState(action, initialActionState);
  return (
    <form action={formAction} className="stack-tight">
      <input type="hidden" name="stand" value={fingerprint} />
      <SubmitButton
        size="lg"
        pendingLabel="Wird veröffentlicht …"
        disabled={disabled}
        confirmMessage={PUBLISH_QUESTION}
      >
        <Upload size={18} aria-hidden="true" />
        Wochenplan veröffentlichen
      </SubmitButton>
      <FormMessage state={state} />
    </form>
  );
}
