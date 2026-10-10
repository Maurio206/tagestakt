import { ShieldCheck } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { TagesTaktMark } from "@/components/brand";
import { Notice } from "@/components/notice";
import { SubmitButton } from "@/components/ui";
import { decideAuthorizationAction } from "@/server/actions/connector";
import { requireUser } from "@/server/auth";
import { resolveClientMetadata } from "@/server/connector/client-metadata";
import { getConnectorConfig } from "@/server/connector/config";
import { parseAuthorizeRequest } from "@/server/connector/oauth";
import { SCOPE_DESCRIPTIONS } from "@/server/connector/scopes";

export const metadata: Metadata = { title: "Claude verbinden" };
export const dynamic = "force-dynamic";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function toSearchParams(raw: Record<string, string | string[] | undefined>): URLSearchParams {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(raw)) {
    for (const item of Array.isArray(value) ? value : value === undefined ? [] : [value]) {
      params.append(key, item);
    }
  }
  return params;
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "unbekannt";
  }
}

/**
 * Freigabeseite des Claude-Connectors (OAuth-Autorisierung). Erreichbar nur angemeldet; der
 * Eigentümer entscheidet ausdrücklich. Kein Passwort wird an Claude weitergegeben.
 */
export default async function AuthorizePage({ searchParams }: { searchParams: SearchParams }) {
  const result = getConnectorConfig();
  if (!result.ok) notFound();
  await requireUser();
  const config = result.config;
  const params = toSearchParams(await searchParams);
  const parsed = await parseAuthorizeRequest(params, config, (clientId) =>
    resolveClientMetadata(clientId, config),
  );
  if (parsed.kind === "redirect") redirect(parsed.location);

  return (
    <main className="centered">
      <div className="login">
        <div className="login-head">
          <TagesTaktMark size={40} />
          <p className="eyebrow">TagesTakt</p>
          <h1>Claude verbinden</h1>
        </div>
        {parsed.kind === "fatal" ? (
          <>
            <Notice tone="error" title="Verbindung nicht möglich" role="alert">
              <p>{parsed.message}</p>
            </Notice>
            <Link className="btn btn--secondary btn--lg btn--block" href="/">
              Zur Übersicht
            </Link>
          </>
        ) : (
          <div className="stack">
            <p>
              <strong>{parsed.request.client.clientName}</strong> (
              {hostOf(parsed.request.client.clientId)}) möchte auf deine Wochenplanung zugreifen:
            </p>
            <ul className="stack-tight">
              {parsed.request.scopes.map((scope) => (
                <li key={scope}>{SCOPE_DESCRIPTIONS[scope]}</li>
              ))}
            </ul>
            <Notice tone="info" title="Was Claude nicht erhält">
              <p>
                Kein Passwort, keine E-Mail-Adresse, keine Tagesnotizen, keine Titel, Orte oder
                Notizen deiner Termine. Gültige Pläne veröffentlicht Claude selbst; die vorherige
                Version bleibt archiviert. Den Zugriff kannst du jederzeit in den Einstellungen
                widerrufen.
              </p>
            </Notice>
            <p className="small muted">
              Erlaube den Zugriff nur, wenn du die Verbindung gerade selbst in Claude gestartet
              hast. Weiterleitung danach an: {hostOf(parsed.request.redirectUri)}
            </p>
            <form action={decideAuthorizationAction} className="stack-tight">
              <input type="hidden" name="anfrage" value={params.toString()} />
              <SubmitButton
                name="entscheidung"
                value="erlauben"
                size="lg"
                className="btn--block"
                pendingLabel="Wird freigegeben …"
              >
                <ShieldCheck size={18} aria-hidden="true" />
                Zugriff erlauben
              </SubmitButton>
              <SubmitButton
                name="entscheidung"
                value="ablehnen"
                variant="secondary"
                size="lg"
                className="btn--block"
                pendingLabel="Wird abgelehnt …"
              >
                Ablehnen
              </SubmitButton>
            </form>
          </div>
        )}
      </div>
    </main>
  );
}
