"use server";

import { redirect } from "next/navigation";
import { z } from "zod";

import { loginErrorMessage } from "@/lib/auth-messages";
import { type ActionState, formValues, readString, validationError } from "@/lib/form";
import { safeReturnPath } from "@/lib/paths";

import { isAllowedUser } from "../auth";
import { createSupabaseServerClient } from "../supabase";

const loginSchema = z.object({
  email: z
    .email({ error: "Bitte eine gültige E-Mail-Adresse angeben" })
    .max(254, { error: "Die E-Mail-Adresse ist zu lang" }),
  password: z
    .string()
    .min(1, { error: "Bitte das Passwort eingeben" })
    .max(256, { error: "Das Passwort ist zu lang" }),
});

export async function loginAction(_state: ActionState, formData: FormData): Promise<ActionState> {
  // Das Passwort wird niemals zurückgegeben oder protokolliert.
  const values = formValues(formData, ["password", "weiter"]);
  const parsed = loginSchema.safeParse({
    email: readString(formData, "email")?.trim(),
    password: readString(formData, "password"),
  });
  if (!parsed.success) return validationError(parsed.error, values);

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error || !data.user) {
    return { status: "error", message: loginErrorMessage(error), values };
  }
  if (!isAllowedUser(data.user.id)) {
    await supabase.auth.signOut();
    return {
      status: "error",
      message: "Dieses Konto ist für TagesTakt nicht freigeschaltet.",
      values,
    };
  }
  // Rücksprung nur zur Connector-Freigabe; alles andere führt zur Startseite.
  redirect(safeReturnPath(readString(formData, "weiter")) ?? "/");
}

export async function logoutAction(): Promise<void> {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
  redirect("/login");
}
