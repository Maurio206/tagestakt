// @ts-check
import { forbiddenSecretEnvSyntax } from "@tagestakt/config/eslint/base";
import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import prettier from "eslint-config-prettier/flat";

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  prettier,
  globalIgnores([".next/**", "out/**", "build/**", "coverage/**", "next-env.d.ts"]),
  {
    rules: {
      "no-console": ["warn", { allow: ["warn", "error"] }],
      eqeqeq: ["error", "always"],
      "@typescript-eslint/consistent-type-imports": ["error", { fixStyle: "inline-type-imports" }],
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@tagestakt/mobile*", "../../mobile/*"],
              message: "Web darf keine Mobile-Dateien importieren.",
            },
            {
              group: ["expo", "expo-*", "react-native", "react-native-*"],
              message: "Keine React-Native-Abhängigkeiten im Web.",
            },
          ],
        },
      ],
    },
  },
  {
    // Client-nahe Bausteine dürfen weder die Data-Access-Schicht noch Secrets anfassen.
    files: ["src/components/**/*.{ts,tsx}", "src/lib/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@/server/*", "**/server/*"],
              message: "Komponenten importieren keine serverseitige Data-Access-Schicht.",
            },
            {
              group: ["@supabase/*"],
              message: "Supabase wird ausschließlich in src/server verwendet.",
            },
            {
              group: ["@anthropic-ai/*"],
              message:
                "Anthropic wird ausschließlich serverseitig in src/server/planner verwendet.",
            },
          ],
        },
      ],
      "no-restricted-syntax": ["error", ...forbiddenSecretEnvSyntax],
    },
  },
]);
