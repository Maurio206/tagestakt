export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  public: {
    Tables: {
      activity_sessions: {
        Row: {
          corrected_at: string | null;
          created_at: string;
          ended_at: string | null;
          goal_category: string;
          id: string;
          owner_id: string;
          schedule_entry_id: string | null;
          started_at: string;
          title: string;
          updated_at: string;
        };
        Insert: {
          corrected_at?: string | null;
          created_at?: string;
          ended_at?: string | null;
          goal_category: string;
          id?: string;
          owner_id?: string;
          schedule_entry_id?: string | null;
          started_at?: string;
          title: string;
          updated_at?: string;
        };
        Update: {
          corrected_at?: string | null;
          created_at?: string;
          ended_at?: string | null;
          goal_category?: string;
          id?: string;
          owner_id?: string;
          schedule_entry_id?: string | null;
          started_at?: string;
          title?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "activity_sessions_entry_owner_fkey";
            columns: ["schedule_entry_id", "owner_id"];
            isOneToOne: false;
            referencedRelation: "schedule_entries";
            referencedColumns: ["id", "owner_id"];
          },
        ];
      };
      daily_notes: {
        Row: {
          content: string;
          created_at: string;
          id: string;
          note_date: string;
          owner_id: string;
          revision: number;
          updated_at: string;
        };
        Insert: {
          content: string;
          created_at?: string;
          id?: string;
          note_date: string;
          owner_id?: string;
          revision?: number;
          updated_at?: string;
        };
        Update: {
          content?: string;
          created_at?: string;
          id?: string;
          note_date?: string;
          owner_id?: string;
          revision?: number;
          updated_at?: string;
        };
        Relationships: [];
      };
      planning_goal_slots: {
        Row: {
          created_at: string;
          duration_minutes: number;
          goal_category: string;
          id: string;
          owner_id: string;
          requirement: string;
          title: string;
          updated_at: string;
          weekday: number;
          window_end: string;
          window_start: string;
        };
        Insert: {
          created_at?: string;
          duration_minutes: number;
          goal_category: string;
          id?: string;
          owner_id?: string;
          requirement: string;
          title: string;
          updated_at?: string;
          weekday: number;
          window_end: string;
          window_start: string;
        };
        Update: {
          created_at?: string;
          duration_minutes?: number;
          goal_category?: string;
          id?: string;
          owner_id?: string;
          requirement?: string;
          title?: string;
          updated_at?: string;
          weekday?: number;
          window_end?: string;
          window_start?: string;
        };
        Relationships: [];
      };
      planning_preferences: {
        Row: {
          buffer_minutes: number;
          business_earliest_start: string;
          business_latest_end: string;
          business_max_block_minutes: number;
          business_max_daily_minutes: number;
          business_min_block_minutes: number;
          business_saturday_max_minutes: number;
          business_sunday_max_minutes: number;
          created_at: string;
          owner_id: string;
          updated_at: string;
        };
        Insert: {
          buffer_minutes: number;
          business_earliest_start: string;
          business_latest_end: string;
          business_max_block_minutes: number;
          business_max_daily_minutes: number;
          business_min_block_minutes: number;
          business_saturday_max_minutes?: number;
          business_sunday_max_minutes?: number;
          created_at?: string;
          owner_id?: string;
          updated_at?: string;
        };
        Update: {
          buffer_minutes?: number;
          business_earliest_start?: string;
          business_latest_end?: string;
          business_max_block_minutes?: number;
          business_max_daily_minutes?: number;
          business_min_block_minutes?: number;
          business_saturday_max_minutes?: number;
          business_sunday_max_minutes?: number;
          created_at?: string;
          owner_id?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      recurring_commitments: {
        Row: {
          active: boolean;
          category: string;
          created_at: string;
          end_time: string;
          id: string;
          location: string | null;
          note: string | null;
          owner_id: string;
          start_time: string;
          title: string;
          updated_at: string;
          weekday: number;
        };
        Insert: {
          active?: boolean;
          category: string;
          created_at?: string;
          end_time: string;
          id?: string;
          location?: string | null;
          note?: string | null;
          owner_id?: string;
          start_time: string;
          title: string;
          updated_at?: string;
          weekday: number;
        };
        Update: {
          active?: boolean;
          category?: string;
          created_at?: string;
          end_time?: string;
          id?: string;
          location?: string | null;
          note?: string | null;
          owner_id?: string;
          start_time?: string;
          title?: string;
          updated_at?: string;
          weekday?: number;
        };
        Relationships: [];
      };
      schedule_entries: {
        Row: {
          category: string;
          completion_status: string;
          created_at: string;
          end_at: string;
          id: string;
          location: string | null;
          note: string | null;
          owner_id: string;
          schedule_week_id: string;
          source: string;
          start_at: string;
          title: string;
          updated_at: string;
        };
        Insert: {
          category: string;
          completion_status?: string;
          created_at?: string;
          end_at: string;
          id?: string;
          location?: string | null;
          note?: string | null;
          owner_id?: string;
          schedule_week_id: string;
          source?: string;
          start_at: string;
          title: string;
          updated_at?: string;
        };
        Update: {
          category?: string;
          completion_status?: string;
          created_at?: string;
          end_at?: string;
          id?: string;
          location?: string | null;
          note?: string | null;
          owner_id?: string;
          schedule_week_id?: string;
          source?: string;
          start_at?: string;
          title?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "schedule_entries_week_owner_fkey";
            columns: ["schedule_week_id", "owner_id"];
            isOneToOne: false;
            referencedRelation: "schedule_weeks";
            referencedColumns: ["id", "owner_id"];
          },
        ];
      };
      schedule_weeks: {
        Row: {
          created_at: string;
          id: string;
          owner_id: string;
          planning_note: string | null;
          published_at: string | null;
          status: string;
          updated_at: string;
          version: number;
          week_start: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          owner_id?: string;
          planning_note?: string | null;
          published_at?: string | null;
          status?: string;
          updated_at?: string;
          version?: number;
          week_start: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          owner_id?: string;
          planning_note?: string | null;
          published_at?: string | null;
          status?: string;
          updated_at?: string;
          version?: number;
          week_start?: string;
        };
        Relationships: [];
      };
      user_settings: {
        Row: {
          created_at: string;
          locale: string;
          owner_id: string;
          remind_at_start: boolean;
          remind_if_not_started: boolean;
          reminder_minutes_before: number | null;
          reminder_scope: string;
          timezone: string;
          updated_at: string;
          weekly_business_target_minutes: number;
          weekly_relationship_target_minutes: number | null;
          weekly_sport_target_minutes: number | null;
        };
        Insert: {
          created_at?: string;
          locale?: string;
          owner_id?: string;
          remind_at_start?: boolean;
          remind_if_not_started?: boolean;
          reminder_minutes_before?: number | null;
          reminder_scope?: string;
          timezone?: string;
          updated_at?: string;
          weekly_business_target_minutes?: number;
          weekly_relationship_target_minutes?: number | null;
          weekly_sport_target_minutes?: number | null;
        };
        Update: {
          created_at?: string;
          locale?: string;
          owner_id?: string;
          remind_at_start?: boolean;
          remind_if_not_started?: boolean;
          reminder_minutes_before?: number | null;
          reminder_scope?: string;
          timezone?: string;
          updated_at?: string;
          weekly_business_target_minutes?: number;
          weekly_relationship_target_minutes?: number | null;
          weekly_sport_target_minutes?: number | null;
        };
        Relationships: [];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      add_schedule_entries: {
        Args: { p_entries: Json; p_replace_existing?: boolean; p_week_id: string };
        Returns: number;
      };
      correct_activity_session: {
        Args: { p_ended_at?: string; p_session_id: string; p_started_at: string };
        Returns: {
          corrected_at: string | null;
          created_at: string;
          ended_at: string | null;
          goal_category: string;
          id: string;
          owner_id: string;
          schedule_entry_id: string | null;
          started_at: string;
          title: string;
          updated_at: string;
        };
        SetofOptions: {
          from: "*";
          to: "activity_sessions";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      create_schedule_draft: {
        Args: { p_week_start: string };
        Returns: {
          created_at: string;
          id: string;
          owner_id: string;
          planning_note: string | null;
          published_at: string | null;
          status: string;
          updated_at: string;
          version: number;
          week_start: string;
        };
        SetofOptions: {
          from: "*";
          to: "schedule_weeks";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      discard_reviewed_schedule_draft: {
        Args: { p_expected_fingerprint: string; p_week_id: string };
        Returns: boolean;
      };
      publish_reviewed_schedule_week: {
        Args: { p_expected_fingerprint: string; p_week_id: string };
        Returns: {
          created_at: string;
          id: string;
          owner_id: string;
          planning_note: string | null;
          published_at: string | null;
          status: string;
          updated_at: string;
          version: number;
          week_start: string;
        };
        SetofOptions: {
          from: "*";
          to: "schedule_weeks";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      publish_schedule_week: {
        Args: { p_week_id: string };
        Returns: {
          created_at: string;
          id: string;
          owner_id: string;
          planning_note: string | null;
          published_at: string | null;
          status: string;
          updated_at: string;
          version: number;
          week_start: string;
        };
        SetofOptions: {
          from: "*";
          to: "schedule_weeks";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      save_daily_note: {
        Args: {
          p_content: string;
          p_expected_id?: string;
          p_expected_revision?: number;
          p_note_date: string;
        };
        Returns: {
          content: string;
          created_at: string;
          id: string;
          note_date: string;
          owner_id: string;
          revision: number;
          updated_at: string;
        }[];
        SetofOptions: {
          from: "*";
          to: "daily_notes";
          isOneToOne: false;
          isSetofReturn: true;
        };
      };
      save_generated_schedule_draft: {
        Args: {
          p_entries: Json;
          p_expected_draft_id: string;
          p_expected_fingerprint: string;
          p_planning_note?: string;
          p_week_start: string;
        };
        Returns: {
          created_at: string;
          id: string;
          owner_id: string;
          planning_note: string | null;
          published_at: string | null;
          status: string;
          updated_at: string;
          version: number;
          week_start: string;
        };
        SetofOptions: {
          from: "*";
          to: "schedule_weeks";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      schedule_week_fingerprint: { Args: { p_week_id: string }; Returns: string };
      start_activity_session: {
        Args: { p_goal_category: string; p_schedule_entry_id?: string; p_title?: string };
        Returns: {
          corrected_at: string | null;
          created_at: string;
          ended_at: string | null;
          goal_category: string;
          id: string;
          owner_id: string;
          schedule_entry_id: string | null;
          started_at: string;
          title: string;
          updated_at: string;
        };
        SetofOptions: {
          from: "*";
          to: "activity_sessions";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      stop_activity_session: {
        Args: { p_session_id?: string };
        Returns: {
          corrected_at: string | null;
          created_at: string;
          ended_at: string | null;
          goal_category: string;
          id: string;
          owner_id: string;
          schedule_entry_id: string | null;
          started_at: string;
          title: string;
          updated_at: string;
        };
        SetofOptions: {
          from: "*";
          to: "activity_sessions";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      switch_activity_session: {
        Args: {
          p_goal_category: string;
          p_schedule_entry_id?: string;
          p_session_id: string;
          p_title?: string;
        };
        Returns: {
          corrected_at: string | null;
          created_at: string;
          ended_at: string | null;
          goal_category: string;
          id: string;
          owner_id: string;
          schedule_entry_id: string | null;
          started_at: string;
          title: string;
          updated_at: string;
        };
        SetofOptions: {
          from: "*";
          to: "activity_sessions";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">;

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    keyof DefaultSchema["Enums"] | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    keyof DefaultSchema["CompositeTypes"] | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  public: {
    Enums: {},
  },
} as const;
