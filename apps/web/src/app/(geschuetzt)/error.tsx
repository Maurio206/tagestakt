"use client";

export default function ProtectedError({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="card stack" role="alert">
      <h1>Etwas ist schiefgelaufen</h1>
      <p>Die Daten konnten nicht geladen werden. Bitte erneut versuchen.</p>
      <button type="button" className="button button--secondary" onClick={reset}>
        Erneut versuchen
      </button>
    </div>
  );
}
