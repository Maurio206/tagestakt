import * as Notifications from "expo-notifications";

import { getPermissionState, requestPermission, syncReminders } from "@/lib/notifications";

import { businessBlock, session, snapshot, sportBlock } from "./fixtures";

const notifications = Notifications as unknown as {
  __scheduled: { identifier: string; content: { title: string; body: string; data: unknown } }[];
  __setPermission: (value: string) => void;
};

beforeEach(() => {
  notifications.__scheduled.length = 0;
  notifications.__setPermission("undetermined");
});

describe("Lokale Erinnerungen", () => {
  const base = snapshot("2026-10-06T14:55:00.000Z", {
    reminderSettings: { minutesBefore: 10, atStart: true, ifNotStarted: true, scope: "all" },
  });
  // 15:00 Berlin: Gewerbe (15:30) und Sport (19:45) liegen noch vor uns.
  const before = new Date("2026-10-06T13:00:00Z");

  it("fragt die Berechtigung erst auf Wunsch an", async () => {
    expect(await getPermissionState()).toBe("undetermined");
    expect(
      await syncReminders({ snapshot: base, enabled: true, showDetails: false, now: before }),
    ).toBe(0);
    expect(Notifications.requestPermissionsAsync).not.toHaveBeenCalled();
    expect(await requestPermission()).toBe("granted");
  });

  it("plant nichts, wenn Erinnerungen auf dem Gerät aus sind", async () => {
    notifications.__setPermission("granted");
    expect(
      await syncReminders({ snapshot: base, enabled: false, showDetails: false, now: before }),
    ).toBe(0);
    expect(notifications.__scheduled).toHaveLength(0);
  });

  it("enthält standardmäßig keine Titel, Orte oder Notizen", async () => {
    notifications.__setPermission("granted");
    const count = await syncReminders({
      snapshot: base,
      enabled: true,
      showDetails: false,
      now: before,
    });
    expect(count).toBeGreaterThan(0);
    for (const request of notifications.__scheduled) {
      const text = `${request.content.title} ${request.content.body}`;
      expect(text).not.toContain("Beispiel");
      expect(Object.keys(request.content.data as object)).toEqual(["kind"]);
    }
    expect(notifications.__scheduled.map((r) => r.content.title)).toContain("Gewerbe in 10 Min.");
  });

  it("zeigt Titel nur, wenn das ausdrücklich eingeschaltet ist", async () => {
    notifications.__setPermission("granted");
    await syncReminders({ snapshot: base, enabled: true, showDetails: true, now: before });
    expect(
      notifications.__scheduled.some((r) => r.content.title.includes(businessBlock.title)),
    ).toBe(true);
  });

  it("ersetzt beim erneuten Abgleich alle alten Erinnerungen (keine Dubletten)", async () => {
    notifications.__setPermission("granted");
    const first = await syncReminders({
      snapshot: base,
      enabled: true,
      showDetails: false,
      now: before,
    });
    const second = await syncReminders({
      snapshot: base,
      enabled: true,
      showDetails: false,
      now: before,
    });
    expect(second).toBe(first);
    expect(notifications.__scheduled).toHaveLength(second);
    expect(new Set(notifications.__scheduled.map((r) => r.identifier)).size).toBe(second);
  });

  it("erinnert nicht an „nicht gestartet“, wenn bereits Zeit erfasst wird", async () => {
    notifications.__setPermission("granted");
    const running = session("sport", "2026-10-06T17:45:00.000Z", null, sportBlock.id);
    const tracked = { ...base, sessions: [running] };
    const later = new Date("2026-10-06T17:46:00Z");
    await syncReminders({ snapshot: tracked, enabled: true, showDetails: false, now: later });
    expect(notifications.__scheduled.map((r) => r.content.title)).not.toContain(
      "Sport noch nicht gestartet",
    );
  });
});
