/**
 * Release-Konfiguration (Plugin `plugins/with-android-release.js`): Debug- und Release-Paket
 * getrennt, Release-Signierung nur aus Werten außerhalb des Repositorys (nie Debug-Schlüssel),
 * Badge-/Install-Referrer-Berechtigungen nur im Release entfernt, benötigte bleiben.
 */
import appConfig from "../../app.json";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const plugin = require("../../plugins/with-android-release") as {
  applyReleaseBuildGradle: (contents: string) => string;
  releaseManifestXml: () => string;
  RELEASE_BLOCKED_PERMISSIONS: string[];
  RELEASE_SIGNING_PROPERTIES: string[];
};

/** Ausschnitt aus der Expo-Vorlage (SDK 57) für android/app/build.gradle. */
const TEMPLATE = `android {
    namespace 'app.tagestakt.privat'
    defaultConfig {
        applicationId 'app.tagestakt.privat'
        versionCode 2
        versionName "0.1.0"
    }
    signingConfigs {
        debug {
            storeFile file('debug.keystore')
            storePassword 'android'
            keyAlias 'androiddebugkey'
            keyPassword 'android'
        }
    }
    buildTypes {
        debug {
            signingConfig signingConfigs.debug
        }
        release {
            // Caution! In production, you need to generate your own keystore file.
            // see https://reactnative.dev/docs/signed-apk-android.
            signingConfig signingConfigs.debug
            def enableShrinkResources = findProperty('android.enableShrinkResourcesInReleaseBuilds') ?: 'false'
            shrinkResources enableShrinkResources.toBoolean()
        }
    }
}
`;

/** Inhalt eines Blocks `name {…}` ab einer Position (einfache Klammerzählung). */
function block(contents: string, header: RegExp): string {
  const match = header.exec(contents);
  if (!match) throw new Error(`Block fehlt: ${header}`);
  let depth = 0;
  for (let i = match.index + match[0].length - 1; i < contents.length; i += 1) {
    if (contents[i] === "{") depth += 1;
    if (contents[i] === "}") depth -= 1;
    if (depth === 0) return contents.slice(match.index, i + 1);
  }
  throw new Error("Block nicht geschlossen");
}

describe("Release-Plugin: build.gradle", () => {
  const out = plugin.applyReleaseBuildGradle(TEMPLATE);
  const buildTypes = block(out, /buildTypes\s*\{/);

  it("Debug heißt app.tagestakt.privat.dev, Release behält app.tagestakt.privat", () => {
    expect(block(buildTypes, /debug\s*\{/)).toMatch(/applicationIdSuffix "\.dev"/);
    expect(block(buildTypes, /release\s*\{/)).not.toMatch(/applicationIdSuffix/);
    expect(out).toContain("applicationId 'app.tagestakt.privat'");
    expect(appConfig.expo.android.package).toBe("app.tagestakt.privat");
  });

  it("Release wird nie mit dem Debug-Schlüssel signiert – ohne externe Werte unsigniert", () => {
    const release = block(buildTypes, /release\s*\{/);
    expect(release).not.toMatch(/signingConfigs\.debug/);
    expect(release).toMatch(
      /signingConfig project\.hasProperty\('TAGESTAKT_RELEASE_STORE_FILE'\) \? signingConfigs\.release : null/,
    );
    expect(block(buildTypes, /debug\s*\{/)).toMatch(/signingConfig signingConfigs\.debug/);
  });

  it("Signierdaten nur über Gradle-Eigenschaften – keine Werte im Repository", () => {
    const signing = block(block(out, /signingConfigs\s*\{/), /release\s*\{/);
    for (const name of plugin.RELEASE_SIGNING_PROPERTIES) {
      expect(signing).toContain(`project.property('${name}')`);
    }
    // Nur Namen, keine Passwörter oder Pfade.
    expect(signing).not.toMatch(/storePassword\s+['"]/);
    expect(signing).not.toMatch(/keyPassword\s+['"]/);
    expect(signing).not.toMatch(/\.jks|\.keystore/);
  });

  it("ist idempotent und bricht ab, wenn die Vorlage nicht passt", () => {
    expect(plugin.applyReleaseBuildGradle(out)).toBe(out);
    expect(() => plugin.applyReleaseBuildGradle("android { }")).toThrow(/nicht eindeutig gefunden/);
  });
});

describe("Release-Plugin: Berechtigungen nur im Release entfernt", () => {
  const xml = plugin.releaseManifestXml();

  it("entfernt alle Badge- und Install-Referrer-Berechtigungen", () => {
    expect(plugin.RELEASE_BLOCKED_PERMISSIONS).toHaveLength(17);
    expect(plugin.RELEASE_BLOCKED_PERMISSIONS).toContain(
      "com.google.android.finsky.permission.BIND_GET_INSTALL_REFERRER_SERVICE",
    );
    for (const name of plugin.RELEASE_BLOCKED_PERMISSIONS) {
      expect(xml).toContain(`<uses-permission android:name="${name}" tools:node="remove" />`);
      expect(name).toMatch(/BADGE|badge|COUNT|SETTINGS|SHORTCUT|INSTALL_REFERRER/);
    }
  });

  it("lässt benötigte Berechtigungen unberührt", () => {
    for (const name of [
      "android.permission.DETECT_SCREEN_CAPTURE",
      "android.permission.POST_NOTIFICATIONS",
      "android.permission.RECEIVE_BOOT_COMPLETED",
      "android.permission.USE_BIOMETRIC",
      "android.permission.INTERNET",
    ]) {
      expect(xml).not.toContain(name);
    }
  });
});
