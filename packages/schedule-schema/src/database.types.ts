export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  public: {
    Tables: {
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
          timezone: string;
          updated_at: string;
          weekly_business_target_minutes: number;
        };
        Insert: {
          created_at?: string;
          locale?: string;
          owner_id?: string;
          timezone?: string;
          updated_at?: string;
          weekly_business_target_minutes?: number;
        };
        Update: {
          created_at?: string;
          locale?: string;
          owner_id?: string;
          timezone?: string;
          updated_at?: string;
          weekly_business_target_minutes?: number;
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
