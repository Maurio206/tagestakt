// @ts-check
import js from "@eslint/js";
import prettier from "eslint-config-prettier/flat";
import tseslint from "typescript-eslint";

/**
 * Gemeinsame Basisregeln für alle TagesTakt-Pakete.
 *
 * Bewusst ohne typgestützte Regeln, damit Lint schnell bleibt;
 * Typfehler fängt `tsc --noEmit` (Task `typecheck`) ab.
 */
export const ignores = {
  ignores: [
    "**/node_modules/**",
    "**/.next/**",
    "**/.expo/**",
    "**/dist/**",
    "**/build/**",
    "**/coverage/**",
    "**/.turbo/**",
    "**/next-env.d.ts",
    "**/expo-env.d.ts",
  ],
};

export const base = tseslint.config(
  ignores,
  js.configs.recommended,
  ...tseslint.configs.strict,
  {
    rules: {
      // Logging nur bewusst: niemals Tokens, Passwörter oder Termininhalte ausgeben.
      "no-console": ["warn", { allow: ["warn", "error"] }],
      eqeqeq: ["error", "always"],
      "@typescript-eslint/consistent-type-imports": ["error", { fixStyle: "inline-type-imports" }],
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
  prettier,
);

/** Importe, die in keinem Client-Code (Browser/App) auftauchen dürfen. */
export const forbiddenSecretEnvSyntax = [
  {
    selector:
      "MemberExpression[object.object.name='process'][object.property.name='env'][property.name=/SECRET|SERVICE_ROLE|ANTHROPIC/]",
    message:
      "Secret-/Service-Role-/Anthropic-Keys dürfen in diesem Paket nicht gelesen werden (nur serverseitig in apps/web/src/server).",
  },
];
