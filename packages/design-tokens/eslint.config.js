// @ts-check
import { base, forbiddenSecretEnvSyntax } from "@tagestakt/config/eslint/base";

export default [
  ...base,
  {
    rules: {
      // Importgrenze: Dieses Paket bleibt UI- und Backend-unabhängig (Web und App nutzen es).
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [
                "react",
                "react-*",
                "react/*",
                "next",
                "next/*",
                "expo",
                "expo-*",
                "@supabase/*",
              ],
              message:
                "@tagestakt/design-tokens enthält nur Werte – keine UI- oder Backend-Bibliotheken.",
            },
            {
              group: ["@tagestakt/web*", "@tagestakt/mobile*", "../../apps/*"],
              message: "Pakete dürfen keine Apps importieren.",
            },
          ],
        },
      ],
      "no-restricted-syntax": ["error", ...forbiddenSecretEnvSyntax],
    },
  },
];
