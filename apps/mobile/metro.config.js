// @ts-check
const { getDefaultConfig } = require("expo/metro-config");

const { nativeBuildOutputs } = require("./metro.native-outputs");

/**
 * Expo-Standardkonfiguration, ergänzt nur um den Ausschluss nativer Build-Ausgaben
 * (siehe metro.native-outputs.js). Das ausgelieferte Bundle ändert sich dadurch nicht.
 */
const config = getDefaultConfig(__dirname);
const defaults = config.resolver.blockList;
config.resolver.blockList = [
  ...(Array.isArray(defaults) ? defaults : defaults ? [defaults] : []),
  ...nativeBuildOutputs,
];

module.exports = config;
