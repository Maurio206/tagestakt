/**
 * Regressionstest: Metro darf native Build-Ausgaben nicht beobachten. Nach einem lokalen
 * Android-Build hing Metro sonst bei 100 % CPU und lieferte kein Bundle (Gerätetest 08.10.2026).
 */
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { nativeBuildOutputs } = require("../../metro.native-outputs") as {
  nativeBuildOutputs: RegExp[];
};

const ROOT_WIN = "C:\\Projekt\\Beispiel\\tagesplan_app";
const ROOT_POSIX = "/home/beispiel/tagesplan_app";

const blocked = (path: string) => nativeBuildOutputs.some((pattern) => pattern.test(path));

describe("Metro: native Build-Ausgaben ausgeschlossen", () => {
  it.each([
    `${ROOT_WIN}\\node_modules\\react-native-screens\\android\\build\\intermediates\\x.jar`,
    `${ROOT_WIN}\\node_modules\\react-native-reanimated\\android\\.cxx\\Debug\\a\\build.ninja`,
    `${ROOT_WIN}\\node_modules\\@react-native-async-storage\\async-storage\\android\\build\\g.java`,
    `${ROOT_POSIX}/node_modules/expo-modules-core/android/.gradle/8.0/file.lock`,
    `${ROOT_WIN}\\apps\\mobile\\android\\app\\.cxx\\Debug\\x\\build.ninja`,
    `${ROOT_POSIX}/apps/mobile/android/build/generated/autolinking.json`,
    `${ROOT_POSIX}/apps/mobile/ios/Pods/x.h`,
  ])("ignoriert %s", (path) => {
    expect(blocked(path)).toBe(true);
  });

  it.each([
    `${ROOT_WIN}\\apps\\mobile\\src\\app\\(tabs)\\woche.tsx`,
    `${ROOT_POSIX}/node_modules/react-native/Libraries/Components/View/View.js`,
    `${ROOT_POSIX}/node_modules/react-native-screens/src/index.tsx`,
    `${ROOT_POSIX}/node_modules/react-native-screens/lib/module/index.js`,
    `${ROOT_POSIX}/node_modules/react-native/ReactAndroid/src/main/jni/x.cpp`,
    `${ROOT_POSIX}/packages/schedule-schema/src/week-grid.ts`,
    `${ROOT_POSIX}/packages/design-tokens/src/index.ts`,
  ])("bündelt weiterhin %s", (path) => {
    expect(blocked(path)).toBe(false);
  });
});
