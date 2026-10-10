"use client";

import { Upload } from "lucide-react";
import { useActionState } from "react";

import { type FormAction, initialActionState } from "@/lib/form";

import { FormMessage, SubmitButton } from "./ui";

/** Wörtliche Rückfrage unmittelbar vor dem Veröffentlichen. */
export const PUBLISH_QUESTION = "Soll dieser Wochenplan veröffentlicht werden?";

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
