/** @type {import('jest').Config} */
module.exports = {
  preset: "jest-expo",
  setupFiles: ["<rootDir>/jest.setup.js"],
  // Komponententests mit Modals sind unter Windows/CI langsamer als das Standardlimit (5 s).
  testTimeout: 20000,
  clearMocks: true,
  testMatch: ["<rootDir>/src/**/*.test.{ts,tsx}"],
  moduleNameMapper: {
    "^@/(.*)$": "<rootDir>/src/$1",
  },
  transformIgnorePatterns: [
    "node_modules/(?!((jest-)?react-native|@react-native(-community)?)|expo(nent)?|@expo(nent)?/.*|expo-router|@tagestakt/.*|@supabase/.*|@tanstack/.*|zod)",
  ],
};
