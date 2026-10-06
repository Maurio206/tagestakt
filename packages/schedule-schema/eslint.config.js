// @ts-check
import { base, forbiddenSecretEnvSyntax } from "@tagestakt/config/eslint/base";

export default [
  ...base,
  {
    rules: {
      // Importgrenze: Dieses Paket bleibt UI- und Backend-unabhängig.
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
                "@tagestakt/schedule-schema darf nicht von UI- oder Backend-Bibliotheken abhängen.",
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
