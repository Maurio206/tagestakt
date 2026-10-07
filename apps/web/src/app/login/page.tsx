import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { TagesTaktMark } from "@/components/brand";
import { LoginForm } from "@/components/login-form";
import { loginAction } from "@/server/actions/auth";
import { getCurrentUser } from "@/server/auth";

export const metadata: Metadata = { title: "Anmelden" };

export default async function LoginPage() {
  if (await getCurrentUser()) redirect("/");

  return (
    <main className="centered">
      <div className="login">
        <div className="login-head">
          <TagesTaktMark size={40} />
          <p className="eyebrow">TagesTakt</p>
          <h1>Anmelden</h1>
          <p className="muted">Privater Zugang. Eine Registrierung ist nicht möglich.</p>
        </div>
        <LoginForm action={loginAction} />
      </div>
    </main>
  );
}
