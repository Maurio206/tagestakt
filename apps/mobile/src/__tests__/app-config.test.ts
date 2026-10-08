/**
 * Regressionstest für die Android-Berechtigungen in `app.json`.
 *
 * `DETECT_SCREEN_CAPTURE` darf nicht gesperrt sein: `expo-screen-capture` registriert unter
 * Android 14+ schon beim Laden einen Screenshot-Melder und bricht ohne die Berechtigung den
 * App-Start ab („Permission Denial: registerScreenCaptureObserver …“, gefunden im Gerätetest).
 * Die Berechtigung erlaubt keine Bildschirmaufnahme – TagesTakt wertet Screenshot-Meldungen auch
 * nicht aus. Alle übrigen Sperren bleiben bestehen.
 */
import appConfig from "../../app.json";

const { android } = appConfig.expo;
const DETECT_SCREEN_CAPTURE = "android.permission.DETECT_SCREEN_CAPTURE";

const STILL_BLOCKED = [
  "android.permission.ACCESS_COARSE_LOCATION",
  "android.permission.ACCESS_FINE_LOCATION",
  "android.permission.ACCESS_BACKGROUND_LOCATION",
  "android.permission.CAMERA",
  "android.permission.RECORD_AUDIO",
  "android.permission.READ_CONTACTS",
  "android.permission.WRITE_CONTACTS",
  "android.permission.READ_CALENDAR",
  "android.permission.WRITE_CALENDAR",
  "android.permission.READ_EXTERNAL_STORAGE",
  "android.permission.WRITE_EXTERNAL_STORAGE",
  "android.permission.SYSTEM_ALERT_WINDOW",
  "android.permission.USE_FINGERPRINT",
  "android.permission.SCHEDULE_EXACT_ALARM",
  "android.permission.USE_EXACT_ALARM",
  "com.google.android.c2dm.permission.RECEIVE",
  "android.permission.READ_MEDIA_IMAGES",
];

describe("Android-Berechtigungen (app.json)", () => {
  it("sperrt DETECT_SCREEN_CAPTURE nicht – expo-screen-capture braucht sie beim Laden", () => {
    expect(android.blockedPermissions).not.toContain(DETECT_SCREEN_CAPTURE);
  });

  it("fordert DETECT_SCREEN_CAPTURE nicht selbst an (kommt nur aus expo-screen-capture)", () => {
    expect(android.permissions).not.toContain(DETECT_SCREEN_CAPTURE);
  });

  it("hält alle übrigen Sperren aufrecht", () => {
    expect([...android.blockedPermissions].sort()).toEqual([...STILL_BLOCKED].sort());
  });

  it("unterstützt Hoch- und Querformat (Jetzt und Wochenraster)", () => {
    expect(appConfig.expo.orientation).toBe("default");
  });

  it("Release: nächster versionCode, eigenes Release-Plugin eingebunden", () => {
    expect(android.versionCode).toBe(2);
    expect(appConfig.expo.plugins).toContain("./plugins/with-android-release");
  });

  it("fordert selbst nur Erinnerungen und Biometrie an, ohne Backup", () => {
    expect([...android.permissions].sort()).toEqual([
      "android.permission.POST_NOTIFICATIONS",
      "android.permission.RECEIVE_BOOT_COMPLETED",
      "android.permission.USE_BIOMETRIC",
    ]);
    expect(android.allowBackup).toBe(false);
    expect(android.package).toBe("app.tagestakt.privat");
  });
});

describe("expo-screen-capture", () => {
  // Quelltext lesen (ohne Node-Typen im App-Projekt).
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const fs = require("fs") as {
    readFileSync: (path: string, encoding: "utf8") => string;
    readdirSync: (path: string) => string[];
    statSync: (path: string) => { isDirectory: () => boolean };
  };
  const resolve = (require as unknown as { resolve: (path: string) => string }).resolve;
  const srcDir = resolve("../lib/screen-privacy.ts").replace(
    /[\\/]lib[\\/]screen-privacy\.ts$/,
    "",
  );

  function sourceFiles(dir: string): string[] {
    return fs.readdirSync(dir).flatMap((name) => {
      const path = `${dir}/${name}`;
      if (fs.statSync(path).isDirectory()) return name === "__tests__" ? [] : sourceFiles(path);
      return /\.tsx?$/.test(name) ? [path] : [];
    });
  }

  it("dient nur dem Schutz der Inhalte, nicht der Auswertung von Screenshots", () => {
    const users = sourceFiles(srcDir).filter((file) =>
      fs.readFileSync(file, "utf8").includes("expo-screen-capture"),
    );
    expect(users.map((file) => file.replace(/\\/g, "/").replace(/^.*\/src\//, ""))).toEqual([
      "lib/screen-privacy.ts",
    ]);
    const source = fs.readFileSync(users[0] ?? "", "utf8");
    expect(source).toMatch(/preventScreenCaptureAsync/);
    expect(source).not.toMatch(/ScreenshotListener|usePermissions|requestPermissionsAsync/);
  });
});
