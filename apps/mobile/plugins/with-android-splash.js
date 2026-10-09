// @ts-check
/**
 * Expo-Konfigurations-Plugin für den Android-Startbildschirm – ohne `expo-splash-screen`
 * (keine zusätzliche native Abhängigkeit). Ersetzt den Platzhalter der Vorlage:
 *
 * - Android 7–11: `Theme.App.SplashScreen` zeigt eine Ebenenliste aus Hintergrundfarbe und
 *   zentriertem Symbol (`splashscreen_logo` je Dichte, aus `image` verkleinert).
 * - Android 12+: System-Startbildschirm mit derselben Hintergrundfarbe
 *   (`windowSplashScreenBackground`); das Symbol ist das Adaptive App-Icon.
 *
 * Optionen: `image` (PNG, transparent), `imageWidth` (dp, Standard 160), `backgroundColor`.
 */
const fs = require("node:fs");
const path = require("node:path");

const { decodePng, encodePng, resize } = require("../scripts/png");

const DENSITIES = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };
const SPLASH_THEME = "Theme.App.SplashScreen";
const COLOR = "splashscreen_background";

/** Ebenenliste für Android 7–11: Farbe plus zentriertes, nicht gestrecktes Symbol. */
function splashDrawableXml() {
  return [
    '<?xml version="1.0" encoding="utf-8"?>',
    "<!-- Generiert von apps/mobile/plugins/with-android-splash.js – nicht von Hand ändern. -->",
    '<layer-list xmlns:android="http://schemas.android.com/apk/res/android">',
    `  <item android:drawable="@color/${COLOR}"/>`,
    "  <item>",
    '    <bitmap android:gravity="center" android:src="@drawable/splashscreen_logo"/>',
    "  </item>",
    "</layer-list>",
    "",
  ].join("\n");
}

/** Stil für Android 12+ (values-v31): System-Startbildschirm in der Hintergrundfarbe. */
function splashStylesV31Xml() {
  return [
    '<?xml version="1.0" encoding="utf-8"?>',
    "<!-- Generiert von apps/mobile/plugins/with-android-splash.js – nicht von Hand ändern. -->",
    "<resources>",
    `  <style name="${SPLASH_THEME}" parent="AppTheme">`,
    '    <item name="android:windowBackground">@drawable/splashscreen</item>',
    `    <item name="android:windowSplashScreenBackground">@color/${COLOR}</item>`,
    "  </style>",
    "</resources>",
    "",
  ].join("\n");
}

/**
 * Setzt im Startbildschirm-Stil die Ebenenliste statt des gestreckten Platzhalterbilds.
 * @param {any} styles  modResults von withAndroidStyles
 */
function applySplashStyle(styles) {
  const list = styles.resources.style ?? [];
  const theme = list.find((/** @type {any} */ s) => s.$?.name === SPLASH_THEME);
  if (!theme) throw new Error(`[with-android-splash] Stil ${SPLASH_THEME} fehlt in styles.xml.`);
  theme.item = (theme.item ?? []).filter(
    (/** @type {any} */ i) => i.$?.name !== "android:windowBackground",
  );
  theme.item.push({ $: { name: "android:windowBackground" }, _: "@drawable/splashscreen" });
  return styles;
}

/**
 * @param {any} colors  modResults von withAndroidColors
 * @param {string} value
 */
function applySplashColor(colors, value) {
  const list = (colors.resources.color ?? []).filter((/** @type {any} */ c) => c.$?.name !== COLOR);
  list.push({ $: { name: COLOR }, _: value });
  colors.resources.color = list;
  return colors;
}

/**
 * Symbol je Dichte aus dem Quell-PNG verkleinern.
 * @param {Buffer} png @param {number} widthDp
 * @returns {Record<string, Buffer>}
 */
function splashLogos(png, widthDp) {
  const source = decodePng(png);
  return Object.fromEntries(
    Object.entries(DENSITIES).map(([density, factor]) => {
      const width = Math.round(widthDp * factor);
      const height = Math.round((width * source.height) / source.width);
      return [density, encodePng(resize(source, width, height))];
    }),
  );
}

/**
 * @param {import("expo/config").ExpoConfig} config
 * @param {{ image: string, imageWidth?: number, backgroundColor: string }} options
 */
function withAndroidSplash(config, options) {
  const { image, imageWidth = 160, backgroundColor } = options ?? {};
  if (!image || !/^#[0-9A-Fa-f]{6}$/.test(backgroundColor ?? "")) {
    throw new Error(
      "[with-android-splash] Optionen image und backgroundColor (#RRGGBB) erforderlich.",
    );
  }
  const { withAndroidColors, withAndroidStyles, withDangerousMod } = require("expo/config-plugins");
  let next = withAndroidColors(config, (mod) => {
    mod.modResults = applySplashColor(mod.modResults, backgroundColor);
    return mod;
  });
  next = withAndroidStyles(next, (mod) => {
    mod.modResults = applySplashStyle(mod.modResults);
    return mod;
  });
  return withDangerousMod(next, [
    "android",
    async (mod) => {
      const res = path.join(mod.modRequest.platformProjectRoot, "app/src/main/res");
      const logos = splashLogos(
        fs.readFileSync(path.join(mod.modRequest.projectRoot, image)),
        imageWidth,
      );
      for (const [density, png] of Object.entries(logos)) {
        fs.mkdirSync(path.join(res, `drawable-${density}`), { recursive: true });
        fs.writeFileSync(path.join(res, `drawable-${density}`, "splashscreen_logo.png"), png);
      }
      fs.mkdirSync(path.join(res, "drawable"), { recursive: true });
      fs.writeFileSync(path.join(res, "drawable", "splashscreen.xml"), splashDrawableXml());
      fs.mkdirSync(path.join(res, "values-v31"), { recursive: true });
      fs.writeFileSync(path.join(res, "values-v31", "styles.xml"), splashStylesV31Xml());
      return mod;
    },
  ]);
}

module.exports = withAndroidSplash;
module.exports.DENSITIES = DENSITIES;
module.exports.applySplashColor = applySplashColor;
module.exports.applySplashStyle = applySplashStyle;
module.exports.splashDrawableXml = splashDrawableXml;
module.exports.splashLogos = splashLogos;
module.exports.splashStylesV31Xml = splashStylesV31Xml;
