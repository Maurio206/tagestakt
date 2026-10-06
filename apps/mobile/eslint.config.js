// @ts-check
const { defineConfig, globalIgnores } = require("eslint/config");
const expoConfig = require("eslint-config-expo/flat");
const prettier = require("eslint-config-prettier/flat");

const secretEnvSelector =
  "MemberExpression[object.object.name='process'][object.property.name='env'][property.name=/SECRET|SERVICE_ROLE/]";

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
          message: "Secret-/Service-Role-Keys gehören niemals in die App.",
        },
      ],
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@react-native-async-storage/async-storage",
              message:
                "AsyncStorage nur über src/lib/plan-cache.ts verwenden – Tokens gehören ausschließlich in SecureStore.",
            },
          ],
          patterns: [
            {
              group: ["next", "next/*", "@supabase/ssr"],
              message: "Keine Web-Abhängigkeiten in der App.",
            },
            {
              group: ["@tagestakt/web*", "../../web/*"],
              message: "Mobile darf keine Web-Dateien importieren.",
            },
          ],
        },
      ],
    },
  },
  {
    // Einzige erlaubte Stelle für AsyncStorage: Zwischenspeicher des veröffentlichten Plans (plus Tests).
    files: ["src/lib/plan-cache.ts", "jest.setup.js", "src/__tests__/**"],
    rules: { "no-restricted-imports": "off" },
  },
]);
