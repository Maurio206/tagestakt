import { type Session } from "@supabase/supabase-js";
import { useQueryClient } from "@tanstack/react-query";
import {
  type ReactNode,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

import { loginErrorMessage } from "@/lib/auth-messages";
import { clearDeviceSettings } from "@/lib/device-settings";
import { type MobileEnv } from "@/lib/env";
import { clearCachedPlan } from "@/lib/plan-cache";
import { type TypedSupabaseClient, getSupabase, wipeLocalSession } from "@/lib/supabase";

interface AuthContextValue {
  session: Session | null;
  initializing: boolean;
  supabase: TypedSupabaseClient;
  /** Liefert eine Fehlermeldung oder null bei Erfolg. */
  signIn: (email: string, password: string) => Promise<string | null>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ env, children }: { env: MobileEnv; children: ReactNode }) {
  const queryClient = useQueryClient();
  const [supabase, setSupabase] = useState(() => getSupabase(env));
  const [session, setSession] = useState<Session | null>(null);
  const [initializing, setInitializing] = useState(true);

  useEffect(() => {
    let active = true;
    supabase.auth
      .getSession()
      .then(({ data }) => {
        if (active) setSession(data.session);
      })
      .finally(() => {
        if (active) setInitializing(false);
      });
    const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      if (active) setSession(nextSession);
    });
    return () => {
      active = false;
      data.subscription.unsubscribe();
    };
  }, [supabase]);

  const signIn = useCallback(
    async (email: string, password: string) => {
      const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
      return error ? loginErrorMessage(error) : null;
    },
    [supabase],
  );

  const signOut = useCallback(async () => {
    try {
      // Widerruft die Sitzung serverseitig, falls online.
      await supabase.auth.signOut({ scope: "local" });
    } catch {
      // Offline: lokale Daten werden trotzdem gelöscht.
    }
    // Immer alle lokalen Daten entfernen – auch wenn der Server nicht erreichbar war.
    // Dazu gehören Plan-Cache und Geräteeinstellungen (App-Sperre).
    await Promise.allSettled([wipeLocalSession(), clearCachedPlan(), clearDeviceSettings()]);
    queryClient.clear();
    setSession(null);
    setSupabase(getSupabase(env));
  }, [supabase, queryClient, env]);

  const value = useMemo(
    () => ({ session, initializing, supabase, signIn, signOut }),
    [session, initializing, supabase, signIn, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth muss innerhalb von AuthProvider verwendet werden.");
  return context;
}
