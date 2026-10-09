// @ts-check
const { defineConfig, globalIgnores } = require("eslint/config");
const expoConfig = require("eslint-config-expo/flat");
const prettier = require("eslint-config-prettier/flat");

const secretEnvSelector =
  "MemberExpression[object.object.name='process'][object.property.name='env'][property.name=/SECRET|SERVICE_ROLE|ANTHROPIC/]";

const asyncStorageRestriction = {
  name: "@react-native-async-storage/async-storage",
  message:
    "AsyncStorage nur über src/lib/plan-cache.ts verwenden – Tokens gehören ausschließlich in SecureStore.",
};
const webPatterns = [
  {
    group: ["next", "next/*", "@supabase/ssr"],
    message: "Keine Web-Abhängigkeiten in der App.",
  },
  {
    group: ["@tagestakt/web*", "../../web/*"],
    message: "Mobile darf keine Web-Dateien importieren.",
  },
  {
    group: ["@anthropic-ai/*"],
    message: "Die App spricht nie direkt mit Anthropic – nur der Web-Server plant.",
  },
];
// Tagesnotizen bleiben online und flüchtig: nie in Offline-Cache, Plan-Abruf, Erinnerungen oder
// das Startbildschirm-Widget.
const dailyNotePatterns = [
  {
    group: [
      "@/lib/daily-notes-api",
      "@/hooks/use-daily-note",
      "./daily-notes-api",
      "**/daily-notes-api",
      "**/use-daily-note",
    ],
    message:
      "Tagesnotizen dürfen nicht in Offline-Cache, Plan-Abruf oder Benachrichtigungen gelangen.",
  },
];

module.exports = defineConfig([
  expoConfig,
  prettier,
  globalIgnores(["dist/**", ".expo/**", "android/**", "ios/**", "coverage/**", "expo-env.d.ts"]),
  {
    rules: {
      "no-console": ["warn", { allow: ["warn", "error"] }],
      eqeqeq: ["error", "always"],
      // Das mobile Bundle darf niemals Secret-/Service-Role-Keys lesen.
      "no-restricted-syntax": [
        "error",
        {
          selector: secretEnvSelector,
          message: "Secret-/Service-Role-/Anthropic-Keys gehören niemals in die App.",
        },
      ],
      "no-restricted-imports": [
        "error",
        { paths: [asyncStorageRestriction], patterns: webPatterns },
      ],
    },
  },
  {
    // Build-Werkzeuge (Icon-Generator, Config-Plugins) laufen in Node, nie im App-Bundle.
    files: ["scripts/**/*.js", "plugins/**/*.js"],
    languageOptions: {
      globals: { __dirname: "readonly", Buffer: "readonly", process: "readonly" },
    },
  },
  {
    files: ["scripts/app-icons.js"],
    rules: { "no-console": "off" },
  },
  {
    // Einzige erlaubte Stelle für AsyncStorage: Zwischenspeicher des veröffentlichten Plans (plus Tests).
    files: ["src/lib/plan-cache.ts", "jest.setup.js", "src/__tests__/**"],
    rules: { "no-restricted-imports": "off" },
  },
  {
    files: ["src/lib/plan-cache.ts"],
    rules: { "no-restricted-imports": ["error", { patterns: dailyNotePatterns }] },
  },
  {
    files: [
      "src/lib/notifications.ts",
      "src/hooks/use-reminder-sync.ts",
      "src/lib/plan-api.ts",
      "src/lib/home-widget.ts",
      "src/hooks/use-widget-sync.ts",
    ],
    rules: {
      "no-restricted-imports": [
        "error",
        { paths: [asyncStorageRestriction], patterns: [...webPatterns, ...dailyNotePatterns] },
      ],
    },
  },
]);
