import { fireEvent, render, screen } from "@testing-library/react-native";

import { LoginView } from "@/components/login-view";
import { type NowActions, NowView } from "@/components/now-view";
import { type PlanResult } from "@/lib/plan-status";

import { NOW, businessBlock, session, snapshot } from "./fixtures";

function actions(): jest.Mocked<NowActions> {
  return {
    start: jest.fn(),
    stop: jest.fn(),
    switchTo: jest.fn(),
    discard: jest.fn(),
    setCompletion: jest.fn(),
    openCorrection: jest.fn(),
    openGoals: jest.fn(),
  };
}

const online = (overrides = {}): PlanResult => ({
  snapshot: snapshot("2026-10-06T14:55:00.000Z", overrides),
  origin: "network",
});

describe("NowView – Jetzt-Ansicht", () => {
  it("zeigt den aktuellen Block, die Restzeit und den nächsten Block", async () => {
    await render(<NowView result={online()} now={NOW} actions={actions()} />);
    expect(screen.getByText("17:00")).toBeOnTheScreen();
    expect(screen.getAllByText("Gewerbe-Block (Beispiel)").length).toBeGreaterThan(0);
    expect(screen.getByLabelText("noch 2 Std. 30 Min.")).toBeOnTheScreen();
    expect(screen.getAllByText("Training (Beispiel)").length).toBeGreaterThan(0);
    expect(screen.getByText("Noch nicht erfasst.")).toBeOnTheScreen();
  });

  it("„Fokus starten“ startet das Ziel des aktuellen Blocks mit Verknüpfung", async () => {
    const a = actions();
    await render(<NowView result={online()} now={NOW} actions={a} />);
    await fireEvent.press(screen.getByRole("button", { name: "Fokus starten" }));
    expect(a.start).toHaveBeenCalledWith("business", businessBlock.id);
  });

  it("markiert einen Block als erledigt oder ausgelassen", async () => {
    const a = actions();
    await render(<NowView result={online()} now={NOW} actions={a} />);
    await fireEvent.press(
      screen.getByRole("button", { name: "„Gewerbe-Block (Beispiel)“ als erledigt markieren" }),
    );
    expect(a.setCompletion).toHaveBeenCalledWith(businessBlock.id, "completed");
  });

  it("zeigt bei laufender Aktivität „Beenden“ und „Zeit korrigieren“", async () => {
    const a = actions();
    const running = session("business", "2026-10-06T13:30:00.000Z", null, businessBlock.id);
    await render(<NowView result={online({ sessions: [running] })} now={NOW} actions={a} />);
    await fireEvent.press(screen.getByRole("button", { name: "Beenden" }));
    expect(a.stop).toHaveBeenCalledWith(running.id);
    await fireEvent.press(screen.getByRole("button", { name: "Zeit korrigieren" }));
    expect(a.openCorrection).toHaveBeenCalledWith(running.id);
  });

  it("bietet beim Wechsel drei klare Optionen und wechselt erst nach Bestätigung", async () => {
    const a = actions();
    // Sport läuft noch, geplant ist jetzt Gewerbe.
    const running = session("sport", "2026-10-06T14:40:00.000Z", null);
    await render(<NowView result={online({ sessions: [running] })} now={NOW} actions={a} />);
    await fireEvent.press(screen.getByRole("button", { name: "Zu Gewerbe wechseln" }));
    expect(a.switchTo).not.toHaveBeenCalled();
    expect(
      screen.getByRole("button", { name: "Sport beenden, Gewerbe starten" }),
    ).toBeOnTheScreen();
    expect(screen.getByRole("button", { name: "Nur Sport beenden" })).toBeOnTheScreen();
    expect(
      screen.getByRole("button", { name: "Abbrechen – Sport läuft weiter" }),
    ).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole("button", { name: "Sport beenden, Gewerbe starten" }));
    expect(a.switchTo).toHaveBeenCalledWith(running.id, "business", businessBlock.id);
  });

  it("offline: deutlicher Hinweis, Plan lesbar, Starten gesperrt", async () => {
    const a = actions();
    const result: PlanResult = {
      snapshot: snapshot("2026-10-06T06:00:00.000Z"),
      origin: "cache",
      errorMessage: "Keine Verbindung zum Server.",
    };
    await render(<NowView result={result} now={NOW} actions={a} />);
    expect(screen.getByText("Offline – gespeicherter Plan")).toBeOnTheScreen();
    expect(screen.getByText(/heute, 08:00 Uhr/)).toBeOnTheScreen();
    expect(screen.getAllByText("Gewerbe-Block (Beispiel)").length).toBeGreaterThan(0);
    const start = screen.getByRole("button", { name: "Fokus starten" });
    expect(start).toBeDisabled();
    await fireEvent.press(start);
    expect(a.start).not.toHaveBeenCalled();
  });

  it("warnt bei veraltetem Plan auch ohne Netzwerkfehler", async () => {
    const result: PlanResult = {
      snapshot: snapshot("2026-10-05T06:00:00.000Z"),
      origin: "network",
    };
    await render(<NowView result={result} now={NOW} actions={actions()} />);
    expect(screen.getByText("Plan möglicherweise veraltet")).toBeOnTheScreen();
  });

  it("meldet eine Woche ohne veröffentlichten Plan und erlaubt spontanes Starten", async () => {
    const a = actions();
    await render(<NowView result={online({ weeks: [] })} now={NOW} actions={a} />);
    expect(
      screen.getByText("Für diese Woche ist noch kein Plan veröffentlicht."),
    ).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole("button", { name: "Aktivität Laila starten" }));
    expect(a.start).toHaveBeenCalledWith("relationship", null);
  });

  it("zeigt den Wochenfortschritt nur aus erfasster Zeit", async () => {
    const done = session("business", "2026-10-05T13:00:00.000Z", "2026-10-05T18:00:00.000Z");
    await render(<NowView result={online({ sessions: [done] })} now={NOW} actions={actions()} />);
    expect(screen.getAllByText(/5 h/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/20 h/).length).toBeGreaterThan(0);
  });
});

describe("LoginView", () => {
  it("bietet keine Registrierung an", async () => {
    await render(<LoginView onSubmit={jest.fn()} />);
    expect(screen.getByLabelText("E-Mail")).toBeOnTheScreen();
    expect(screen.getByLabelText("Passwort")).toBeOnTheScreen();
    expect(screen.queryByRole("button", { name: /Registrier/i })).toBeNull();
    expect(
      screen.getByText("Privater Zugang. Eine Registrierung ist nicht möglich."),
    ).toBeOnTheScreen();
  });

  it("meldet fehlende Eingaben ohne Anfrage an den Server", async () => {
    const onSubmit = jest.fn();
    await render(<LoginView onSubmit={onSubmit} />);
    await fireEvent.press(screen.getByRole("button", { name: "Anmelden" }));
    expect(await screen.findByText("Bitte E-Mail und Passwort eingeben.")).toBeOnTheScreen();
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
