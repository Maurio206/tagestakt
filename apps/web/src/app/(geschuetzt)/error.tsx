"use client";

import { OctagonAlert } from "lucide-react";

export default function ProtectedError({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="notice notice--error" role="alert">
      <OctagonAlert size={20} strokeWidth={1.9} aria-hidden="true" className="icon" />
      <div className="notice-body">
        <h1 className="notice-title">Die Daten konnten nicht geladen werden</h1>
        <p>
          Vermutlich ist die Verbindung zum Server kurz unterbrochen. Deine Daten sind nicht
          verloren. Bitte erneut versuchen.
        </p>
        <div className="button-row">
          <button type="button" className="btn btn--secondary" onClick={reset}>
            Erneut versuchen
          </button>
        </div>
      </div>
    </div>
  );
}
