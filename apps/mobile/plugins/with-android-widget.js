// @ts-check
/**
 * Expo-Konfigurations-Plugin für das Android-Startbildschirm-Widget „Jetzt und danach“ – ohne
 * Fremdbibliothek. Wirkt bei jedem Prebuild (der Ordner `android/` ist generiert):
 *
 * - Kotlin aus `plugins/android-widget/*.kt`: AppWidgetProvider, Bridge-Modul für die App
 *   (`src/lib/home-widget.ts`) und das Datenformat. Das Modul wird in MainApplication
 *   registriert (klassisches Modul über die Interop-Schicht der New Architecture).
 * - Layouts aus `plugins/android-widget/res/layout/`; Farben (Design-Tokens, Palette „dark“),
 *   Texte, Maße, Formen, Logo (Vektor aus dem Master-SVG) und Widget-Metadaten werden erzeugt.
 * - Manifest: ein Receiver (APPWIDGET_UPDATE, Uhrzeit, Zeitzone, Neustart, App-Update) –
 *   keine zusätzliche Berechtigung (RECEIVE_BOOT_COMPLETED ist bereits vorhanden), keine
 *   Exact Alarms, kein Netzwerk.
 */
const fs = require("node:fs");
const path = require("node:path");

const { readLogo } = require("../scripts/app-icons");

const MARKER = "// @tagestakt/widget";
const TEMPLATE_DIR = path.join(__dirname, "android-widget");
const KOTLIN_FILES = [
  "TagesTaktWidgetProvider.kt",
  "TagesTaktWidgetModule.kt",
  "TagesTaktWidgetPackage.kt",
  "WidgetPayload.kt",
];
const LAYOUT_FILES = ["tagestakt_widget.xml", "tagestakt_widget_preview.xml"];
const HEADER =
  "<!-- Generiert von apps/mobile/plugins/with-android-widget.js – nicht von Hand ändern. -->";

/** Größe: Standard 4 × 2, mindestens 3 × 2 Zellen (Android-Formel 70 × n − 30 dp). */
const WIDGET_SIZE = {
  minWidth: "250dp",
  minHeight: "110dp",
  minResizeWidth: "180dp",
  minResizeHeight: "110dp",
  targetCellWidth: 4,
  targetCellHeight: 2,
};
/** Sparsamer Rückfall (1 h); die Blockwechsel plant der Provider selbst an den Grenzen. */
const UPDATE_PERIOD_MS = 3_600_000;

/** Ereignisse, nach denen das Widget neu zeichnet. */
const RECEIVER_ACTIONS = [
  "android.appwidget.action.APPWIDGET_UPDATE",
  "android.intent.action.TIME_SET",
  "android.intent.action.TIMEZONE_CHANGED",
  "android.intent.action.BOOT_COMPLETED",
  "android.intent.action.MY_PACKAGE_REPLACED",
];

/**
 * Farben aus packages/design-tokens (Palette „dark“); ein Test vergleicht sie mit
 * `palettes.dark` und `blockColors(palettes.dark, tone, "strong")`.
 */
const WIDGET_COLORS = {
  background: "#121110",
  line: "#302E2A",
  lineStrong: "#76716A",
  text: "#F3EFE8",
  textMuted: "#BDB6AA",
  textSubtle: "#979083",
  action: "#E2B04A",
};
/** Farbton → Akzent (Palette) und Fläche/Rand des hervorgehobenen Blocks (Betonung „strong“). */
const TONE_COLORS = {
  business: { accent: "#E2B04A", background: "#4A3D23", border: "#C49942" },
  sport: { accent: "#5DBE86", background: "#2A4132", border: "#53A575" },
  relationship: { accent: "#EC8FA3", background: "#4C3539", border: "#CC7D8E" },
  duty: { accent: "#88A6C6", background: "#343B41", border: "#7791AB" },
  violet: { accent: "#A99BD8", background: "#3C3845", border: "#9387BB" },
  neutral: { accent: "#A59E92", background: "#3B3935", border: "#908A7F" },
};

/** Texte (identisch mit WIDGET_TEXTS in packages/schedule-schema/src/widget.ts – per Test). */
const WIDGET_STRINGS = {
  tagestakt_widget_label: "Jetzt und danach",
  tagestakt_widget_description:
    "Aktueller und nächster Block aus deinem veröffentlichten Wochenplan.",
  tagestakt_widget_now: "Jetzt",
  tagestakt_widget_next: "Danach",
  tagestakt_widget_nothing_next: "nichts mehr geplant",
  tagestakt_widget_no_plan: "Kein aktueller Wochenplan",
  tagestakt_widget_stale: "Plan nicht aktuell",
  tagestakt_widget_signed_out: "Nicht angemeldet",
  tagestakt_widget_open: "TagesTakt öffnen",
  // Vorschau in der Widget-Auswahl – frei erfunden.
  tagestakt_widget_preview_meta: "Gewerbe · 09:00–11:00",
  tagestakt_widget_preview_title: "Beispielblock",
  tagestakt_widget_preview_next_time: "11:30",
  tagestakt_widget_preview_next_text: "Beispiel · Sport",
};

/** @param {string} value */
function escapeXml(value) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "\\'");
}

/** @param {string[]} lines */
function xml(lines) {
  return ['<?xml version="1.0" encoding="utf-8"?>', HEADER, ...lines, ""].join("\n");
}

function colorsXml() {
  /** @type {string[]} */
  const entries = [];
  const snake = (/** @type {string} */ key) => key.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
  for (const [key, value] of Object.entries(WIDGET_COLORS)) {
    entries.push(`  <color name="tagestakt_widget_${snake(key)}">${value}</color>`);
  }
  for (const [tone, colors] of Object.entries(TONE_COLORS)) {
    entries.push(`  <color name="tagestakt_widget_tone_${tone}">${colors.accent}</color>`);
  }
  return xml(["<resources>", ...entries, "</resources>"]);
}

function stringsXml() {
  const entries = Object.entries(WIDGET_STRINGS).map(
    ([name, value]) => `  <string name="${name}">${escapeXml(value)}</string>`,
  );
  return xml(["<resources>", ...entries, "</resources>"]);
}

/** @param {boolean} v31  Android 12+: Systemradien des Launchers. */
function dimensXml(v31) {
  const lines = v31
    ? [
        '  <dimen name="tagestakt_widget_radius">@android:dimen/system_app_widget_background_radius</dimen>',
        '  <dimen name="tagestakt_widget_inner_radius">@android:dimen/system_app_widget_inner_radius</dimen>',
      ]
    : [
        '  <dimen name="tagestakt_widget_radius">16dp</dimen>',
        '  <dimen name="tagestakt_widget_inner_radius">10dp</dimen>',
        '  <dimen name="tagestakt_widget_padding">12dp</dimen>',
        '  <dimen name="tagestakt_widget_logo_small">18dp</dimen>',
        '  <dimen name="tagestakt_widget_logo_large">44dp</dimen>',
      ];
  return xml(["<resources>", ...lines, "</resources>"]);
}

/** @param {{ fill: string, stroke: string, dashed?: boolean, radius: string }} shape */
function shapeXml({ fill, stroke, dashed = false, radius }) {
  const dash = dashed ? ' android:dashWidth="4dp" android:dashGap="3dp"' : "";
  return xml([
    '<shape xmlns:android="http://schemas.android.com/apk/res/android" android:shape="rectangle">',
    `  <solid android:color="${fill}"/>`,
    `  <stroke android:width="1dp" android:color="${stroke}"${dash}/>`,
    `  <corners android:radius="${radius}"/>`,
    "</shape>",
  ]);
}

/** Alle erzeugten Formen: Hintergrund, Blockflächen je Farbton, freie Zeit, Akzentkante, Punkt. */
function drawables() {
  /** @type {Record<string, string>} */
  const files = {
    tagestakt_widget_background: shapeXml({
      fill: WIDGET_COLORS.background,
      stroke: WIDGET_COLORS.line,
      radius: "@dimen/tagestakt_widget_radius",
    }),
    tagestakt_widget_card_free: shapeXml({
      fill: "#00000000",
      stroke: WIDGET_COLORS.lineStrong,
      dashed: true,
      radius: "@dimen/tagestakt_widget_inner_radius",
    }),
    tagestakt_widget_bar: xml([
      '<shape xmlns:android="http://schemas.android.com/apk/res/android" android:shape="rectangle">',
      '  <solid android:color="#FFFFFF"/>',
      '  <corners android:radius="2dp"/>',
      "</shape>",
    ]),
    tagestakt_widget_dot: xml([
      '<shape xmlns:android="http://schemas.android.com/apk/res/android" android:shape="oval">',
      '  <solid android:color="#FFFFFF"/>',
      '  <size android:width="8dp" android:height="8dp"/>',
      "</shape>",
    ]),
  };
  for (const [tone, colors] of Object.entries(TONE_COLORS)) {
    files[`tagestakt_widget_card_${tone}`] = shapeXml({
      fill: colors.background,
      stroke: colors.border,
      radius: "@dimen/tagestakt_widget_inner_radius",
    });
  }
  return files;
}

/** @param {number} n */
function num(n) {
  return String(Math.round(n * 1000) / 1000);
}

/**
 * Logo „Fokusstapel“ als Vektor: Vordergrund des Master-SVG (Hintergrund = Widgetfläche),
 * auf das Motiv zugeschnitten (1 Einheit Rand).
 * @param {ReturnType<typeof readLogo>} logo
 */
function logoVectorXml(logo) {
  const shapes = logo.shapes.filter((s) => s.layer === "foreground");
  const box = shapes.reduce(
    (b, s) => {
      const [x0, y0, x1, y1] =
        s.kind === "rect"
          ? [s.x, s.y, s.x + s.width, s.y + s.height]
          : [s.cx - s.r, s.cy - s.r, s.cx + s.r, s.cy + s.r];
      return [Math.min(b[0], x0), Math.min(b[1], y0), Math.max(b[2], x1), Math.max(b[3], y1)];
    },
    [Infinity, Infinity, -Infinity, -Infinity],
  );
  const pad = 1;
  const [left, top] = [box[0] - pad, box[1] - pad];
  const width = box[2] - box[0] + 2 * pad;
  const height = box[3] - box[1] + 2 * pad;
  const paths = shapes.map((s) => {
    let d;
    if (s.kind === "circle") {
      d = `M${num(s.cx - s.r)},${num(s.cy)} a${num(s.r)},${num(s.r)} 0 1,0 ${num(2 * s.r)},0 a${num(s.r)},${num(s.r)} 0 1,0 ${num(-2 * s.r)},0 z`;
    } else {
      const r = Math.min(s.rx, s.width / 2, s.height / 2);
      const h = s.width - 2 * r;
      const v = s.height - 2 * r;
      d =
        `M${num(s.x + r)},${num(s.y)} h${num(h)} a${num(r)},${num(r)} 0 0,1 ${num(r)},${num(r)} ` +
        `v${num(v)} a${num(r)},${num(r)} 0 0,1 ${num(-r)},${num(r)} h${num(-h)} ` +
        `a${num(r)},${num(r)} 0 0,1 ${num(-r)},${num(-r)} v${num(-v)} a${num(r)},${num(r)} 0 0,1 ${num(r)},${num(-r)} z`;
    }
    const alpha = s.opacity < 1 ? ` android:fillAlpha="${num(s.opacity)}"` : "";
    return `    <path android:name="${s.id}" android:fillColor="${s.fill}"${alpha} android:pathData="${d}"/>`;
  });
  const dpWidth = 24;
  return xml([
    `<!-- Logo „Fokusstapel“ v${logo.version} aus assets/branding/tagestakt-logo.svg -->`,
    '<vector xmlns:android="http://schemas.android.com/apk/res/android"',
    `    android:width="${dpWidth}dp" android:height="${num((dpWidth * height) / width)}dp"`,
    `    android:viewportWidth="${num(width)}" android:viewportHeight="${num(height)}">`,
    `  <group android:translateX="${num(-left)}" android:translateY="${num(-top)}">`,
    ...paths,
    "  </group>",
    "</vector>",
  ]);
}

function widgetInfoXml() {
  return xml([
    '<appwidget-provider xmlns:android="http://schemas.android.com/apk/res/android"',
    '    android:description="@string/tagestakt_widget_description"',
    '    android:initialLayout="@layout/tagestakt_widget"',
    '    android:previewLayout="@layout/tagestakt_widget_preview"',
    `    android:minWidth="${WIDGET_SIZE.minWidth}"`,
    `    android:minHeight="${WIDGET_SIZE.minHeight}"`,
    `    android:minResizeWidth="${WIDGET_SIZE.minResizeWidth}"`,
    `    android:minResizeHeight="${WIDGET_SIZE.minResizeHeight}"`,
    `    android:targetCellWidth="${WIDGET_SIZE.targetCellWidth}"`,
    `    android:targetCellHeight="${WIDGET_SIZE.targetCellHeight}"`,
    '    android:resizeMode="horizontal|vertical"',
    `    android:updatePeriodMillis="${UPDATE_PERIOD_MS}"`,
    '    android:widgetCategory="home_screen" />',
  ]);
}

/**
 * Kotlin-Vorlage mit Paketnamen.
 * @param {string} file @param {string} pkg
 */
function kotlinSource(file, pkg) {
  const source = fs
    .readFileSync(path.join(TEMPLATE_DIR, file), "utf8")
    .replace(/\{\{PACKAGE\}\}/g, pkg);
  if (source.includes("{{")) throw new Error(`[with-android-widget] Platzhalter in ${file} übrig.`);
  return source;
}

/**
 * Alle Ressourcen- und Quelldateien relativ zu `android/app/src/main`.
 * @param {string} projectRoot @param {string} pkg
 * @returns {Record<string, string>}
 */
function widgetFiles(projectRoot, pkg) {
  /** @type {Record<string, string>} */
  const files = {};
  const javaDir = path.posix.join("java", ...pkg.split("."), "widget");
  for (const file of KOTLIN_FILES) files[`${javaDir}/${file}`] = kotlinSource(file, pkg);
  for (const file of LAYOUT_FILES) {
    files[`res/layout/${file}`] = fs.readFileSync(
      path.join(TEMPLATE_DIR, "res", "layout", file),
      "utf8",
    );
  }
  for (const [name, contents] of Object.entries(drawables()))
    files[`res/drawable/${name}.xml`] = contents;
  files["res/drawable/tagestakt_widget_logo.xml"] = logoVectorXml(readLogo(projectRoot));
  files["res/values/tagestakt_widget_colors.xml"] = colorsXml();
  files["res/values/tagestakt_widget_strings.xml"] = stringsXml();
  files["res/values/tagestakt_widget_dimens.xml"] = dimensXml(false);
  files["res/values-v31/tagestakt_widget_dimens.xml"] = dimensXml(true);
  files["res/xml/tagestakt_widget_info.xml"] = widgetInfoXml();
  return files;
}

/**
 * Trägt den Widget-Receiver ein (idempotent). Exportiert, weil Launcher und System ihn
 * aufrufen; er liest keine Daten aus Intents.
 * @param {any} manifest  modResults von withAndroidManifest
 * @param {string} pkg
 */
function applyWidgetManifest(manifest, pkg) {
  const application = manifest.manifest.application?.[0];
  if (!application) throw new Error("[with-android-widget] <application> fehlt im Manifest.");
  const name = `${pkg}.widget.TagesTaktWidgetProvider`;
  const receivers = (application.receiver ?? []).filter(
    (/** @type {any} */ r) => r.$?.["android:name"] !== name,
  );
  receivers.push({
    $: {
      "android:name": name,
      "android:exported": "true",
      "android:label": "@string/tagestakt_widget_label",
    },
    "intent-filter": [
      { action: RECEIVER_ACTIONS.map((action) => ({ $: { "android:name": action } })) },
    ],
    "meta-data": [
      {
        $: {
          "android:name": "android.appwidget.provider",
          "android:resource": "@xml/tagestakt_widget_info",
        },
      },
    ],
  });
  application.receiver = receivers;
  return manifest;
}

/**
 * Registriert das Bridge-Modul in MainApplication.kt (idempotent).
 * @param {string} contents @param {string} pkg
 */
function applyMainApplication(contents, pkg) {
  if (contents.includes(MARKER)) return contents;
  const anchor = /PackageList\(this\)\.packages\.apply\s*\{/g;
  const matches = contents.match(anchor);
  if (!matches || matches.length !== 1) {
    throw new Error(
      "[with-android-widget] PackageList(this).packages.apply { in MainApplication.kt nicht eindeutig gefunden.",
    );
  }
  return contents.replace(
    /(PackageList\(this\)\.packages\.apply\s*\{)/,
    `$1\n          add(${pkg}.widget.TagesTaktWidgetPackage()) ${MARKER}`,
  );
}

/** @param {import("expo/config").ExpoConfig} config */
function withAndroidWidget(config) {
  const pkg = config.android?.package;
  if (!pkg || !/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/.test(pkg)) {
    throw new Error("[with-android-widget] android.package fehlt oder ist ungültig.");
  }
  const {
    withAndroidManifest,
    withMainApplication,
    withDangerousMod,
  } = require("expo/config-plugins");
  let next = withAndroidManifest(config, (mod) => {
    mod.modResults = applyWidgetManifest(mod.modResults, pkg);
    return mod;
  });
  next = withMainApplication(next, (mod) => {
    if (mod.modResults.language !== "kt") {
      throw new Error("[with-android-widget] MainApplication.kt (Kotlin) erwartet.");
    }
    mod.modResults.contents = applyMainApplication(mod.modResults.contents, pkg);
    return mod;
  });
  return withDangerousMod(next, [
    "android",
    async (mod) => {
      const main = path.join(mod.modRequest.platformProjectRoot, "app/src/main");
      for (const [file, contents] of Object.entries(widgetFiles(mod.modRequest.projectRoot, pkg))) {
        const target = path.join(main, file);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, contents);
      }
      return mod;
    },
  ]);
}

module.exports = withAndroidWidget;
module.exports.KOTLIN_FILES = KOTLIN_FILES;
module.exports.LAYOUT_FILES = LAYOUT_FILES;
module.exports.RECEIVER_ACTIONS = RECEIVER_ACTIONS;
module.exports.TONE_COLORS = TONE_COLORS;
module.exports.UPDATE_PERIOD_MS = UPDATE_PERIOD_MS;
module.exports.WIDGET_COLORS = WIDGET_COLORS;
module.exports.WIDGET_SIZE = WIDGET_SIZE;
module.exports.WIDGET_STRINGS = WIDGET_STRINGS;
module.exports.applyMainApplication = applyMainApplication;
module.exports.applyWidgetManifest = applyWidgetManifest;
module.exports.logoVectorXml = logoVectorXml;
module.exports.widgetFiles = widgetFiles;
module.exports.widgetInfoXml = widgetInfoXml;
