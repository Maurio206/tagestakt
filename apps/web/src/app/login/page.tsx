import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { TagesTaktMark } from "@/components/brand";
import { LoginForm } from "@/components/login-form";
import { safeReturnPath } from "@/lib/paths";
import { loginAction } from "@/server/actions/auth";
import { getCurrentUser } from "@/server/auth";

export const metadata: Metadata = { title: "Anmelden" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function LoginPage({ searchParams }: { searchParams: SearchParams }) {
  const { weiter } = await searchParams;
  // Nur die Connector-Freigabe ist als Rücksprung erlaubt (keine offenen Redirects).
  const returnPath = safeReturnPath(typeof weiter === "string" ? weiter : null);
  if (await getCurrentUser()) redirect(returnPath ?? "/");

  return (
    <main className="centered">
      <div className="login">
        <div className="login-head">
          <TagesTaktMark size={40} />
          <p className="eyebrow">TagesTakt</p>
          <h1>Anmelden</h1>
          <p className="muted">Privater Zugang. Eine Registrierung ist nicht möglich.</p>
        </div>
        {returnPath ? (
          <p className="small muted">
            Nach der Anmeldung geht es weiter zur Freigabe für den Claude-Connector.
          </p>
        ) : null}
        <LoginForm action={loginAction} returnPath={returnPath} />
      </div>
    </main>
  );
}
