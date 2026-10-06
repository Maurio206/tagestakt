import { Body, Button, Card, Eyebrow, Muted } from "./ui";

export function PlanError({ message, onRetry }: { message?: string; onRetry: () => void }) {
  return (
    <Card>
      <Eyebrow>Kein Plan verfügbar</Eyebrow>
      <Body>{message ?? "Der Plan konnte nicht geladen werden."}</Body>
      <Muted>Es ist noch kein Plan auf diesem Gerät gespeichert. Bitte Verbindung prüfen.</Muted>
      <Button label="Erneut versuchen" onPress={onRetry} variant="secondary" />
    </Card>
  );
}
