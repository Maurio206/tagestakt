import Link from "next/link";

export default function NotFound() {
  return (
    <main className="centered">
      <div className="card stack">
        <h1>Seite nicht gefunden</h1>
        <p>Diese Seite gibt es nicht.</p>
        <Link href="/" className="button button--secondary">
          Zur Übersicht
        </Link>
      </div>
    </main>
  );
}
