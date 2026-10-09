/**
 * Config-Plugin des Startbildschirm-Widgets (`plugins/with-android-widget.js`): Manifest und
 * Receiver, Registrierung in MainApplication, Provider-Metadaten (4 × 2, mindestens 3 × 2),
 * Ressourcen aus Design-Tokens und Master-Logo, keine Exact Alarms, kein Netzwerk, keine
 * Daten aus Intents – reproduzierbar bei jedem Prebuild.
 */
import { TONES, blockColors, palettes } from "@tagestakt/design-tokens";
import { WIDGET_TEXTS } from "@tagestakt/schedule-schema";

import appConfig from "../../app.json";

/* eslint-disable @typescript-eslint/no-require-imports */
type Manifest = {
  manifest: {
    "uses-permission"?: unknown[];
    application?: { receiver?: Receiver[] }[];
  };
};
type Receiver = {
  $: Record<string, string>;
  "intent-filter": { action: { $: { "android:name": string } }[] }[];
  "meta-data": { $: Record<string, string> }[];
};
const plugin = require("../../plugins/with-android-widget") as {
  KOTLIN_FILES: string[];
  LAYOUT_FILES: string[];
  RECEIVER_ACTIONS: string[];
  TONE_COLORS: Record<string, { accent: string; background: string; border: string }>;
  UPDATE_PERIOD_MS: number;
  WIDGET_COLORS: Record<string, string>;
  WIDGET_SIZE: Record<string, string | number>;
  WIDGET_STRINGS: Record<string, string>;
  applyMainApplication: (contents: string, pkg: string) => string;
  applyWidgetManifest: (manifest: Manifest, pkg: string) => Manifest;
  widgetFiles: (projectRoot: string, pkg: string) => Record<string, string>;
  widgetInfoXml: () => string;
};
const icons = require("../../scripts/app-icons") as {
  readLogo: (root: string) => { shapes: { id: string; layer: string; fill: string }[] };
};
const resolve = (require as unknown as { resolve: (path: string) => string }).resolve;
/* eslint-enable @typescript-eslint/no-require-imports */

const PKG = "app.tagestakt.privat";
const mobileRoot = resolve("../../app.json").replace(/[\\/]app\.json$/, "");
const files = plugin.widgetFiles(mobileRoot, PKG);
const kotlin = plugin.KOTLIN_FILES.map(
  (file) => files[`java/app/tagestakt/privat/widget/${file}`] ?? "",
).join("\n");
const layouts = plugin.LAYOUT_FILES.map((file) => files[`res/layout/${file}`] ?? "");
const dark = palettes.dark;
const { android } = appConfig.expo;

/** Ressourcennamen eines Typs aus den erzeugten Dateien (Dateinamen bzw. <type name="…">). */
function definedResources(type: "drawable" | "layout" | "xml" | "color" | "string" | "dimen") {
  const names = new Set<string>();
  for (const [file, contents] of Object.entries(files)) {
    const fileMatch = new RegExp(`^res/${type}/([a-z0-9_]+)\\.xml$`).exec(file);
    if (fileMatch?.[1]) names.add(fileMatch[1]);
    for (const m of contents.matchAll(new RegExp(`<${type} name="([a-z0-9_]+)"`, "g"))) {
      if (m[1]) names.add(m[1]);
    }
  }
  return names;
}

describe("app.json", () => {
  it("bindet das Widget-Plugin ein, versionCode 4, Paket unverändert", () => {
    expect(appConfig.expo.plugins).toContain("./plugins/with-android-widget");
    expect(android.versionCode).toBe(4);
    expect(android.package).toBe(PKG);
    expect(appConfig.expo.version).toBe("0.1.0");
  });

  it("fordert keine zusätzlichen Berechtigungen an, Exact Alarms bleiben gesperrt", () => {
    expect([...android.permissions].sort()).toEqual([
      "android.permission.POST_NOTIFICATIONS",
      "android.permission.RECEIVE_BOOT_COMPLETED",
      "android.permission.USE_BIOMETRIC",
    ]);
    expect(android.blockedPermissions).toEqual(
      expect.arrayContaining([
        "android.permission.SCHEDULE_EXACT_ALARM",
        "android.permission.USE_EXACT_ALARM",
      ]),
    );
  });
});

describe("Manifest", () => {
  const base = (): Manifest => ({
    manifest: { "uses-permission": [{ $: { "android:name": "x" } }], application: [{}] },
  });

  it("trägt genau einen Widget-Receiver mit Provider-Metadaten ein", () => {
    const result = plugin.applyWidgetManifest(base(), PKG);
    const receivers = result.manifest.application?.[0]?.receiver ?? [];
    expect(receivers).toHaveLength(1);
    const receiver = receivers[0] as Receiver;
    expect(receiver.$).toEqual({
      "android:name": `${PKG}.widget.TagesTaktWidgetProvider`,
      "android:exported": "true",
      "android:label": "@string/tagestakt_widget_label",
    });
    expect(receiver["intent-filter"][0]?.action.map((a) => a.$["android:name"])).toEqual([
      "android.appwidget.action.APPWIDGET_UPDATE",
      "android.intent.action.TIME_SET",
      "android.intent.action.TIMEZONE_CHANGED",
      "android.intent.action.BOOT_COMPLETED",
      "android.intent.action.MY_PACKAGE_REPLACED",
    ]);
    expect(receiver["meta-data"]).toEqual([
      {
        $: {
          "android:name": "android.appwidget.provider",
          "android:resource": "@xml/tagestakt_widget_info",
        },
      },
    ]);
  });

  it("ist idempotent und fügt keine Berechtigung hinzu", () => {
    const once = plugin.applyWidgetManifest(base(), PKG);
    const twice = plugin.applyWidgetManifest(once, PKG);
    expect(twice.manifest.application?.[0]?.receiver).toHaveLength(1);
    expect(twice.manifest["uses-permission"]).toHaveLength(1);
  });
});

describe("MainApplication", () => {
  const TEMPLATE = `class MainApplication : Application(), ReactApplication {
  override val reactHost: ReactHost by lazy {
    ExpoReactHostFactory.getDefaultReactHost(
      context = applicationContext,
      packageList =
        PackageList(this).packages.apply {
          // Packages that cannot be autolinked yet can be added manually here, for example:
          // add(MyReactNativePackage())
        }
    )
  }
}`;

  it("registriert das Bridge-Modul genau einmal (idempotent)", () => {
    const once = plugin.applyMainApplication(TEMPLATE, PKG);
    expect(once).toContain(`add(${PKG}.widget.TagesTaktWidgetPackage()) // @tagestakt/widget`);
    expect(plugin.applyMainApplication(once, PKG)).toBe(once);
    expect(once.match(/TagesTaktWidgetPackage/g)).toHaveLength(1);
  });

  it("bricht ab, wenn die Vorlage unerwartet aussieht", () => {
    expect(() => plugin.applyMainApplication("class MainApplication", PKG)).toThrow(
      /nicht eindeutig/,
    );
  });
});

describe("Provider-Metadaten", () => {
  const info = plugin.widgetInfoXml();

  it("Standard 4 × 2, mindestens 3 × 2, frei skalierbar, nur Startbildschirm", () => {
    expect(info).toContain('android:targetCellWidth="4"');
    expect(info).toContain('android:targetCellHeight="2"');
    expect(info).toContain('android:minWidth="250dp"');
    expect(info).toContain('android:minHeight="110dp"');
    expect(info).toContain('android:minResizeWidth="180dp"');
    expect(info).toContain('android:minResizeHeight="110dp"');
    expect(info).toContain('android:resizeMode="horizontal|vertical"');
    expect(info).toContain('android:widgetCategory="home_screen"');
    expect(info).toContain('android:initialLayout="@layout/tagestakt_widget"');
    expect(info).toContain('android:previewLayout="@layout/tagestakt_widget_preview"');
    expect(info).toContain('android:description="@string/tagestakt_widget_description"');
    expect(info).not.toContain("configure");
  });

  it("sparsamer periodischer Rückfall (mindestens 30 Minuten)", () => {
    expect(plugin.UPDATE_PERIOD_MS).toBeGreaterThanOrEqual(30 * 60_000);
    expect(info).toContain(`android:updatePeriodMillis="${plugin.UPDATE_PERIOD_MS}"`);
  });
});

describe("Ressourcen", () => {
  it("erzeugt alle Dateien reproduzierbar", () => {
    expect(plugin.widgetFiles(mobileRoot, PKG)).toEqual(files);
    expect(Object.keys(files).sort()).toEqual(
      [
        "java/app/tagestakt/privat/widget/TagesTaktWidgetModule.kt",
        "java/app/tagestakt/privat/widget/TagesTaktWidgetPackage.kt",
        "java/app/tagestakt/privat/widget/TagesTaktWidgetProvider.kt",
        "java/app/tagestakt/privat/widget/WidgetPayload.kt",
        "res/drawable/tagestakt_widget_background.xml",
        "res/drawable/tagestakt_widget_bar.xml",
        ...TONES.map((tone) => `res/drawable/tagestakt_widget_card_${tone}.xml`),
        "res/drawable/tagestakt_widget_card_free.xml",
        "res/drawable/tagestakt_widget_dot.xml",
        "res/drawable/tagestakt_widget_logo.xml",
        "res/layout/tagestakt_widget.xml",
        "res/layout/tagestakt_widget_preview.xml",
        "res/values-v31/tagestakt_widget_dimens.xml",
        "res/values/tagestakt_widget_colors.xml",
        "res/values/tagestakt_widget_dimens.xml",
        "res/values/tagestakt_widget_strings.xml",
        "res/xml/tagestakt_widget_info.xml",
      ].sort(),
    );
  });

  it("Farben stammen aus den Design-Tokens (Palette „dark“, Anthrazit-Hintergrund)", () => {
    expect(plugin.WIDGET_COLORS).toEqual({
      background: dark.bg,
      line: dark.line,
      lineStrong: dark.lineStrong,
      text: dark.text,
      textMuted: dark.textMuted,
      textSubtle: dark.textSubtle,
      action: dark.business,
    });
    expect(Object.keys(plugin.TONE_COLORS).sort()).toEqual([...TONES].sort());
    for (const tone of TONES) {
      const strong = blockColors(dark, tone, "strong");
      expect(plugin.TONE_COLORS[tone]).toEqual({
        accent: dark[tone],
        background: strong.background,
        border: strong.border,
      });
      expect(files[`res/drawable/tagestakt_widget_card_${tone}.xml`]).toContain(strong.background);
    }
    expect(files["res/drawable/tagestakt_widget_background.xml"]).toContain(
      `<solid android:color="${dark.bg}"/>`,
    );
  });

  it("Texte entsprechen der gemeinsamen Fachlogik (Deutsch)", () => {
    const s = plugin.WIDGET_STRINGS;
    expect(s.tagestakt_widget_label).toBe(WIDGET_TEXTS.label);
    expect(s.tagestakt_widget_description).toBe(WIDGET_TEXTS.description);
    expect(s.tagestakt_widget_now).toBe(WIDGET_TEXTS.now);
    expect(s.tagestakt_widget_next).toBe(WIDGET_TEXTS.next);
    expect(s.tagestakt_widget_nothing_next).toBe(WIDGET_TEXTS.nothingNext);
    expect(s.tagestakt_widget_no_plan).toBe("Kein aktueller Wochenplan");
    expect(s.tagestakt_widget_no_plan).toBe(WIDGET_TEXTS.noPlan);
    expect(s.tagestakt_widget_stale).toBe(WIDGET_TEXTS.stale);
    expect(s.tagestakt_widget_signed_out).toBe(WIDGET_TEXTS.signedOut);
    expect(s.tagestakt_widget_open).toBe("TagesTakt öffnen");
    expect(s.tagestakt_widget_open).toBe(WIDGET_TEXTS.open);
  });

  it("Vorschau zeigt nur frei erfundene Beispielinhalte", () => {
    expect(plugin.WIDGET_STRINGS.tagestakt_widget_preview_title).toMatch(/Beispiel/);
    expect(plugin.WIDGET_STRINGS.tagestakt_widget_preview_next_text).toMatch(/Beispiel/);
  });

  it("Logo „Fokusstapel“ als Vektor aus dem Master-SVG (nur Vordergrund)", () => {
    const vector = files["res/drawable/tagestakt_widget_logo.xml"] ?? "";
    const foreground = icons.readLogo(mobileRoot).shapes.filter((s) => s.layer === "foreground");
    const paths = [...vector.matchAll(/<path android:name="([^"]+)" android:fillColor="([^"]+)"/g)];
    expect(paths.map((m) => [m[1], m[2]])).toEqual(foreground.map((s) => [s.id, s.fill]));
    expect(vector).not.toContain("hintergrund");
  });

  it("Layouts nutzen nur RemoteViews-taugliche Klassen und vorhandene Ressourcen", () => {
    const allowed = new Set(["FrameLayout", "LinearLayout", "TextView", "ImageView"]);
    for (const layout of layouts) {
      for (const [, tag] of layout.matchAll(/<([A-Za-z][\w.]*)[\s>]/g)) {
        expect(allowed).toContain(tag);
      }
      for (const type of ["drawable", "color", "dimen", "string"] as const) {
        const defined = definedResources(type);
        if (type === "string") defined.add("app_name"); // aus der Expo-Vorlage
        for (const [, name] of layout.matchAll(new RegExp(`@${type}/([a-z0-9_]+)`, "g"))) {
          expect(defined).toContain(name);
        }
      }
    }
  });

  it("Kotlin verweist nur auf vorhandene IDs und Ressourcen", () => {
    const ids = new Set(
      [...(files["res/layout/tagestakt_widget.xml"] ?? "").matchAll(/@\+id\/([a-z0-9_]+)/g)].map(
        (m) => m[1],
      ),
    );
    // android.R.id.background ist die System-ID der Widgetfläche (abgerundete Ecken ab Android 12).
    for (const [, id] of kotlin.matchAll(/(?<!android\.)R\.id\.([a-z0-9_]+)/g)) {
      expect(ids).toContain(id);
    }
    expect(files["res/layout/tagestakt_widget.xml"]).toContain(
      'android:id="@android:id/background"',
    );
    for (const type of ["drawable", "color", "string", "layout"] as const) {
      const defined = definedResources(type);
      for (const [, name] of kotlin.matchAll(new RegExp(`R\\.${type}\\.([a-z0-9_]+)`, "g"))) {
        expect(defined).toContain(name);
      }
    }
  });
});

describe("Kotlin: Sicherheit und Sparsamkeit", () => {
  it("setzt den Paketnamen ein, keine Platzhalter übrig", () => {
    expect(kotlin).toContain(`package ${PKG}.widget`);
    expect(kotlin).toContain(`import ${PKG}.MainActivity`);
    expect(kotlin).not.toContain("{{");
  });

  it("nur inexakte, nicht weckende Aktualisierung – keine Exact Alarms", () => {
    expect(kotlin).toContain("alarms.setWindow(AlarmManager.RTC,");
    expect(kotlin).not.toMatch(
      /setExact|setAlarmClock|AndAllowWhileIdle|RTC_WAKEUP|ELAPSED_REALTIME_WAKEUP|SCHEDULE_EXACT_ALARM|USE_EXACT_ALARM/,
    );
  });

  it("kein Netzwerkzugriff, keine Protokollierung, keine Daten aus Intents", () => {
    expect(kotlin).not.toMatch(/java\.net|HttpURLConnection|okhttp|URL\(|Socket|fetch/);
    expect(kotlin).not.toMatch(/android\.util\.Log|Log\.[dviwe]\(|println/);
    expect(kotlin).not.toMatch(/getStringExtra|getExtras|getIntArrayExtra|intent\.data/);
  });

  it("speichert nur app-intern und mit unveränderlichen PendingIntents", () => {
    expect(kotlin).toContain("Context.MODE_PRIVATE");
    const pendingIntents = kotlin.match(/PendingIntent\.get(Activity|Broadcast)\(/g) ?? [];
    expect(pendingIntents).toHaveLength(2);
    expect(kotlin.match(/PendingIntent\.FLAG_IMMUTABLE/g)?.length).toBeGreaterThanOrEqual(2);
  });

  it("Antippen öffnet TagesTakt explizit in „Jetzt“ (Startroute)", () => {
    expect(kotlin).toContain('OPEN_URI = "tagestakt://"');
    expect(kotlin).toContain("MainActivity::class.java");
    expect(kotlin).toContain("setOnClickPendingIntent(android.R.id.background");
  });
});
