// @ts-check
/**
 * Expo-Konfigurations-Plugin für den eigenständigen Android-Release. Wirkt bei jedem Prebuild
 * (der Ordner `android/` ist generiert und nicht im Repository):
 *
 * 1. Debug-Builds heißen `<Paket>.dev` (z. B. `app.tagestakt.privat.dev`), der Release behält
 *    `app.tagestakt.privat`. So kollidieren Entwicklungs- und Release-App nie.
 * 2. Der Release wird mit einem eigenen Schlüssel signiert. Pfad, Alias und Passwörter kommen
 *    ausschließlich aus Gradle-Eigenschaften außerhalb des Repositorys (`gradle.properties` im
 *    GRADLE_USER_HOME). Fehlen sie, entsteht eine **unsignierte** APK – niemals eine mit dem
 *    öffentlich bekannten Debug-Schlüssel signierte.
 * 3. Badge- und Install-Referrer-Berechtigungen (aus Bibliotheken) werden nur im Release
 *    entfernt. Die App nutzt keine Badges (`shouldSetBadge`/`showBadge: false`) und keinen Store.
 */
const fs = require("node:fs");
const path = require("node:path");

/** Gradle-Eigenschaften der Release-Signierung (nur Namen – Werte nie im Repository). */
const RELEASE_SIGNING_PROPERTIES = [
  "TAGESTAKT_RELEASE_STORE_FILE",
  "TAGESTAKT_RELEASE_STORE_PASSWORD",
  "TAGESTAKT_RELEASE_KEY_ALIAS",
  "TAGESTAKT_RELEASE_KEY_PASSWORD",
];

/** Nur im Release entfernt (stammen aus Bibliotheken von expo-notifications bzw. Expo). */
const RELEASE_BLOCKED_PERMISSIONS = [
  "android.permission.READ_APP_BADGE",
  "com.anddoes.launcher.permission.UPDATE_COUNT",
  "com.google.android.finsky.permission.BIND_GET_INSTALL_REFERRER_SERVICE",
  "com.htc.launcher.permission.READ_SETTINGS",
  "com.htc.launcher.permission.UPDATE_SHORTCUT",
  "com.huawei.android.launcher.permission.CHANGE_BADGE",
  "com.huawei.android.launcher.permission.READ_SETTINGS",
  "com.huawei.android.launcher.permission.WRITE_SETTINGS",
  "com.majeur.launcher.permission.UPDATE_BADGE",
  "com.oppo.launcher.permission.READ_SETTINGS",
  "com.oppo.launcher.permission.WRITE_SETTINGS",
  "com.sec.android.provider.badge.permission.READ",
  "com.sec.android.provider.badge.permission.WRITE",
  "com.sonyericsson.home.permission.BROADCAST_BADGE",
  "com.sonymobile.home.permission.PROVIDER_INSERT_BADGE",
  "me.everything.badger.permission.BADGE_COUNT_READ",
  "me.everything.badger.permission.BADGE_COUNT_WRITE",
];

const MARKER = "// @tagestakt/release";
const [STORE_FILE, STORE_PASSWORD, KEY_ALIAS, KEY_PASSWORD] = RELEASE_SIGNING_PROPERTIES;

const SIGNING_BLOCK = `
        release { ${MARKER}
            // Nur aus Gradle-Eigenschaften außerhalb des Repositorys (GRADLE_USER_HOME/gradle.properties).
            if (project.hasProperty('${STORE_FILE}')) {
                storeFile file(project.property('${STORE_FILE}'))
                storePassword project.property('${STORE_PASSWORD}')
                keyAlias project.property('${KEY_ALIAS}')
                keyPassword project.property('${KEY_PASSWORD}')
            }
        }`;

/** Ersetzt genau eine Fundstelle; sonst Abbruch, statt still eine falsche Konfiguration zu bauen. */
function replaceOnce(contents, pattern, replacement, what) {
  const all = new RegExp(
    pattern.source,
    pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`,
  );
  const matches = contents.match(all);
  if (!matches || matches.length !== 1) {
    throw new Error(
      `[with-android-release] ${what}: erwartete Stelle in app/build.gradle nicht eindeutig gefunden.`,
    );
  }
  return contents.replace(pattern, replacement);
}

/** Passt `android/app/build.gradle` an (idempotent). */
function applyReleaseBuildGradle(contents) {
  if (contents.includes(MARKER)) return contents;
  let out = replaceOnce(
    contents,
    /(buildTypes\s*\{\s*debug\s*\{)/,
    `$1\n            applicationIdSuffix ".dev" ${MARKER}`,
    "Debug-Paketname",
  );
  // Zuerst den Build-Typ – vor dem Einfügen des gleichnamigen Signierblocks.
  out = replaceOnce(
    out,
    /(\n\s*release\s*\{(?:(?!\n\s*\}\s*\n)[\s\S])*?)signingConfig signingConfigs\.debug/,
    `$1signingConfig project.hasProperty('${STORE_FILE}') ? signingConfigs.release : null ${MARKER}`,
    "Release-Build-Typ",
  );
  out = replaceOnce(out, /(signingConfigs\s*\{)/, `$1${SIGNING_BLOCK}`, "Release-Signierung");
  return out;
}

/** Manifest nur für den Release: entfernt die Badge- und Install-Referrer-Berechtigungen. */
function releaseManifestXml() {
  const lines = RELEASE_BLOCKED_PERMISSIONS.map(
    (name) => `  <uses-permission android:name="${name}" tools:node="remove" />`,
  );
  return [
    "<!-- Generiert von apps/mobile/plugins/with-android-release.js – nicht von Hand ändern. -->",
    '<manifest xmlns:android="http://schemas.android.com/apk/res/android" xmlns:tools="http://schemas.android.com/tools">',
    ...lines,
    "</manifest>",
    "",
  ].join("\n");
}

/** @param {import("expo/config").ExpoConfig} config */
function withAndroidRelease(config) {
  const { withAppBuildGradle, withDangerousMod } = require("expo/config-plugins");
  const withGradle = withAppBuildGradle(config, (mod) => {
    if (mod.modResults.language !== "groovy") {
      throw new Error("[with-android-release] app/build.gradle (Groovy) erwartet.");
    }
    mod.modResults.contents = applyReleaseBuildGradle(mod.modResults.contents);
    return mod;
  });
  return withDangerousMod(withGradle, [
    "android",
    async (mod) => {
      const file = path.join(
        mod.modRequest.platformProjectRoot,
        "app/src/release/AndroidManifest.xml",
      );
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, releaseManifestXml());
      return mod;
    },
  ]);
}

module.exports = withAndroidRelease;
module.exports.applyReleaseBuildGradle = applyReleaseBuildGradle;
module.exports.releaseManifestXml = releaseManifestXml;
module.exports.RELEASE_BLOCKED_PERMISSIONS = RELEASE_BLOCKED_PERMISSIONS;
module.exports.RELEASE_SIGNING_PROPERTIES = RELEASE_SIGNING_PROPERTIES;
