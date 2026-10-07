import "server-only";

import {
  type Database,
  DEFAULT_LOCALE,
  DEFAULT_REMINDER_MINUTES_BEFORE,
  DEFAULT_WEEKLY_BUSINESS_TARGET_MINUTES,
  type GoalSettingsInputParsed,
  type GoalTargets,
  type ReminderScope,
  type ReminderSettingsInput,
  SCHEDULE_TIMEZONE,
  goalTargetsFromSettings,
  userSettingsRowSchema,
} from "@tagestakt/schedule-schema";

import { authorizedClient } from "../auth";
import { toUserFacingError } from "../errors";

export interface SettingsView {
  timezone: string;
  locale: string;
  /** Rohwert der Spalte (0 = kein Gewerbeziel). */
  weeklyBusinessTargetMinutes: number;
  weeklySportTargetMinutes: number | null;
  weeklyRelationshipTargetMinutes: number | null;
  /** Ziele für die Berechnung (`null` = kein Ziel). */
  goalTargets: GoalTargets;
  reminders: {
    minutesBefore: number | null;
    atStart: boolean;
    ifNotStarted: boolean;
    scope: ReminderScope;
  };
  /** false, solange noch keine Einstellungszeile gespeichert wurde. */
  persisted: boolean;
}

const DEFAULT_SETTINGS: SettingsView = {
  timezone: SCHEDULE_TIMEZONE,
  locale: DEFAULT_LOCALE,
  weeklyBusinessTargetMinutes: DEFAULT_WEEKLY_BUSINESS_TARGET_MINUTES,
  weeklySportTargetMinutes: null,
  weeklyRelationshipTargetMinutes: null,
  goalTargets: {
    business: DEFAULT_WEEKLY_BUSINESS_TARGET_MINUTES,
    sport: null,
    relationship: null,
  },
  reminders: {
    minutesBefore: DEFAULT_REMINDER_MINUTES_BEFORE,
    atStart: true,
    ifNotStarted: false,
    scope: "important",
  },
  persisted: false,
};

export async function getSettings(): Promise<SettingsView> {
  const { supabase } = await authorizedClient();
  const { data, error } = await supabase.from("user_settings").select("*").maybeSingle();
  if (error) throw toUserFacingError("Einstellungen laden", error);
  if (!data) return DEFAULT_SETTINGS;
  const row = userSettingsRowSchema.parse(data);
  return {
    timezone: row.timezone,
    locale: row.locale,
    weeklyBusinessTargetMinutes: row.weekly_business_target_minutes,
    weeklySportTargetMinutes: row.weekly_sport_target_minutes,
    weeklyRelationshipTargetMinutes: row.weekly_relationship_target_minutes,
    goalTargets: goalTargetsFromSettings(row),
    reminders: {
      minutesBefore: row.reminder_minutes_before,
      atStart: row.remind_at_start,
      ifNotStarted: row.remind_if_not_started,
      scope: row.reminder_scope,
    },
    persisted: true,
  };
}

type SettingsColumns = Omit<Database["public"]["Tables"]["user_settings"]["Insert"], "owner_id">;

async function upsertSettings(operation: string, columns: SettingsColumns): Promise<void> {
  const { supabase, user } = await authorizedClient();
  const { error } = await supabase
    .from("user_settings")
    .upsert({ owner_id: user.id, ...columns }, { onConflict: "owner_id" });
  if (error) throw toUserFacingError(operation, error);
}

export async function saveGoalTargets(input: GoalSettingsInputParsed): Promise<void> {
  await upsertSettings("Wochenziele speichern", {
    weekly_business_target_minutes: input.weeklyBusinessTargetMinutes,
    weekly_sport_target_minutes: input.weeklySportTargetMinutes,
    weekly_relationship_target_minutes: input.weeklyRelationshipTargetMinutes,
  });
}

export async function saveReminderSettings(input: ReminderSettingsInput): Promise<void> {
  await upsertSettings("Erinnerungen speichern", {
    reminder_minutes_before: input.reminderMinutesBefore,
    remind_at_start: input.remindAtStart,
    remind_if_not_started: input.remindIfNotStarted,
    reminder_scope: input.reminderScope,
  });
}
