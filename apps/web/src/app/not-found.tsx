import Link from "next/link";

import { TagesTaktMark } from "@/components/brand";

export default function NotFound() {
  return (
    <main className="centered">
      <div className="login">
        <div className="login-head">
          <TagesTaktMark size={40} />
          <h1>Seite nicht gefunden</h1>
          <p className="muted">Diese Seite gibt es nicht.</p>
        </div>
        <Link href="/" className="btn btn--secondary">
          Zur Übersicht
        </Link>
      </div>
    </main>
  );
}
