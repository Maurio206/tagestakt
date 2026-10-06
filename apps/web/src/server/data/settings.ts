import "server-only";

import {
  DEFAULT_LOCALE,
  DEFAULT_WEEKLY_BUSINESS_TARGET_MINUTES,
  SCHEDULE_TIMEZONE,
  userSettingsRowSchema,
} from "@tagestakt/schedule-schema";

import { authorizedClient } from "../auth";
import { toUserFacingError } from "../errors";

export interface SettingsView {
  timezone: string;
  locale: string;
  weeklyBusinessTargetMinutes: number;
  /** false, solange noch keine Einstellungszeile gespeichert wurde. */
  persisted: boolean;
}

export async function getSettings(): Promise<SettingsView> {
  const { supabase } = await authorizedClient();
  const { data, error } = await supabase.from("user_settings").select("*").maybeSingle();
  if (error) throw toUserFacingError("Einstellungen laden", error);
  if (!data) {
    return {
      timezone: SCHEDULE_TIMEZONE,
      locale: DEFAULT_LOCALE,
      weeklyBusinessTargetMinutes: DEFAULT_WEEKLY_BUSINESS_TARGET_MINUTES,
      persisted: false,
    };
  }
  const row = userSettingsRowSchema.parse(data);
  return {
    timezone: row.timezone,
    locale: row.locale,
    weeklyBusinessTargetMinutes: row.weekly_business_target_minutes,
    persisted: true,
  };
}

export async function saveWeeklyTarget(minutes: number): Promise<void> {
  const { supabase, user } = await authorizedClient();
  const { error } = await supabase
    .from("user_settings")
    .upsert(
      { owner_id: user.id, weekly_business_target_minutes: minutes },
      { onConflict: "owner_id" },
    );
  if (error) throw toUserFacingError("Wochenziel speichern", error);
}
