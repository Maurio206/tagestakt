import { type Database } from "@tagestakt/schedule-schema";
import { type SupabaseClient, createClient } from "@supabase/supabase-js";
import { AppState, type AppStateStatus } from "react-native";

import { type MobileEnv } from "./env";
import { secureSessionStorage } from "./secure-storage";

/** Fester Schlüssel, damit die Session beim Abmelden auch offline sicher gelöscht werden kann. */
export const AUTH_STORAGE_KEY = "tagestakt.auth";
const AUTH_STORAGE_KEYS = [
  AUTH_STORAGE_KEY,
  `${AUTH_STORAGE_KEY}-code-verifier`,
  `${AUTH_STORAGE_KEY}-user`,
];

export type TypedSupabaseClient = SupabaseClient<Database>;

let client: TypedSupabaseClient | null = null;
let appStateSubscription: { remove: () => void } | null = null;

/**
 * Supabase-Client der App. Erhält ausschließlich den Publishable Key;
 * Tokens liegen nur in SecureStore (siehe secure-storage.ts).
 */
export function getSupabase(env: MobileEnv): TypedSupabaseClient {
  if (client) return client;
  client = createClient<Database>(
    env.EXPO_PUBLIC_SUPABASE_URL,
    env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    {
      auth: {
        storage: secureSessionStorage,
        storageKey: AUTH_STORAGE_KEY,
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: false,
      },
    },
  );

  // Token-Refresh nur im Vordergrund (Empfehlung von Supabase für React Native).
  const supabase = client;
  const onChange = (state: AppStateStatus) => {
    if (state === "active") supabase.auth.startAutoRefresh();
    else supabase.auth.stopAutoRefresh();
  };
  appStateSubscription?.remove();
  appStateSubscription = AppState.addEventListener("change", onChange);
  onChange(AppState.currentState);
  return client;
}

/** Entfernt alle Sitzungsdaten aus SecureStore und verwirft den Client samt Speicherzustand. */
export async function wipeLocalSession(): Promise<void> {
  client?.auth.stopAutoRefresh();
  appStateSubscription?.remove();
  appStateSubscription = null;
  client = null;
  await Promise.all(AUTH_STORAGE_KEYS.map((key) => secureSessionStorage.removeItem(key)));
}
