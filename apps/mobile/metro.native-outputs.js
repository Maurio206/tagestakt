// @ts-check
/**
 * Native Build-Ausgaben, die Metro weder einlesen noch beobachten soll. Ein lokaler Android-Build
 * schreibt Zehntausende Dateien nach `node_modules/<paket>/android/{build,.cxx}` und in das
 * generierte `apps/mobile/android/`; Metro beobachtet im Monorepo das ganze Repository und hing
 * danach bei 100 % CPU ohne Antwort (die Debug-App blieb grau). JavaScript liegt dort nie.
 */
const nativeBuildOutputs = [
  // Build-Verzeichnisse nativer Bibliotheken (Gradle, CMake/ninja, Gradle-Cache)
  /[\\/]node_modules[\\/](?:@[^\\/]+[\\/])?[^\\/]+[\\/]android[\\/](?:build|\.cxx|\.gradle)[\\/].*/,
  // Generierte native Projekte der App (Expo-Prebuild)
  /[\\/]apps[\\/]mobile[\\/](?:android|ios)[\\/].*/,
];

module.exports = { nativeBuildOutputs };
