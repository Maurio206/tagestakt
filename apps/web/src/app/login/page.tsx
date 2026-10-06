import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { LoginForm } from "@/components/login-form";
import { loginAction } from "@/server/actions/auth";
import { getCurrentUser } from "@/server/auth";

export const metadata: Metadata = { title: "Anmelden" };

export default async function LoginPage() {
  if (await getCurrentUser()) redirect("/");

  return (
    <main className="centered">
      <div className="card stack login-card">
        <div>
          <p className="eyebrow">TagesTakt</p>
          <h1>Anmelden</h1>
          <p className="muted">Privater Zugang. Eine Registrierung ist nicht möglich.</p>
        </div>
        <LoginForm action={loginAction} />
      </div>
    </main>
  );
}
