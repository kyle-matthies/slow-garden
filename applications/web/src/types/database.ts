export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  public: {
    Tables: {
      accounts: {
        Row: {
          created_at: string
          display_name: string | null
          id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          display_name?: string | null
          id?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          display_name?: string | null
          id?: string
          updated_at?: string
        }
        Relationships: []
      }
      bloom_responses: {
        Row: {
          bloom_id: string
          correction: string | null
          created_at: string
          id: string
          response: string
          tenant_id: string
        }
        Insert: {
          bloom_id: string
          correction?: string | null
          created_at?: string
          id: string
          response: string
          tenant_id?: string
        }
        Update: {
          bloom_id?: string
          correction?: string | null
          created_at?: string
          id?: string
          response?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "bloom_responses_bloom_id_tenant_id_fkey"
            columns: ["bloom_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "blooms"
            referencedColumns: ["id", "tenant_id"]
          },
        ]
      }
      blooms: {
        Row: {
          created_at: string
          evidence: Json
          garden_id: string
          id: string
          interpretation: string
          kind: string
          ordinal: number
          pass_id: string
          tenant_id: string
        }
        Insert: {
          created_at?: string
          evidence: Json
          garden_id: string
          id?: string
          interpretation: string
          kind: string
          ordinal: number
          pass_id: string
          tenant_id: string
        }
        Update: {
          created_at?: string
          evidence?: Json
          garden_id?: string
          id?: string
          interpretation?: string
          kind?: string
          ordinal?: number
          pass_id?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "blooms_pass_id_tenant_id_garden_id_fkey"
            columns: ["pass_id", "tenant_id", "garden_id"]
            isOneToOne: false
            referencedRelation: "garden_passes"
            referencedColumns: ["id", "tenant_id", "garden_id"]
          },
        ]
      }
      entries: {
        Row: {
          archived_at: string | null
          created_at: string
          garden_id: string
          id: string
          seed_id: string
          tenant_id: string
        }
        Insert: {
          archived_at?: string | null
          created_at?: string
          garden_id: string
          id?: string
          seed_id: string
          tenant_id?: string
        }
        Update: {
          archived_at?: string | null
          created_at?: string
          garden_id?: string
          id?: string
          seed_id?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "entries_seed_id_tenant_id_garden_id_fkey"
            columns: ["seed_id", "tenant_id", "garden_id"]
            isOneToOne: false
            referencedRelation: "seeds"
            referencedColumns: ["id", "tenant_id", "garden_id"]
          },
        ]
      }
      garden_passes: {
        Row: {
          created_at: string
          finished_at: string | null
          garden_id: string
          id: string
          no_output_reason: string | null
          plot_ids: string[]
          status: string
          tenant_id: string
        }
        Insert: {
          created_at?: string
          finished_at?: string | null
          garden_id: string
          id: string
          no_output_reason?: string | null
          plot_ids: string[]
          status?: string
          tenant_id?: string
        }
        Update: {
          created_at?: string
          finished_at?: string | null
          garden_id?: string
          id?: string
          no_output_reason?: string | null
          plot_ids?: string[]
          status?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "garden_passes_garden_id_tenant_id_fkey"
            columns: ["garden_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "gardens"
            referencedColumns: ["id", "tenant_id"]
          },
        ]
      }
      gardens: {
        Row: {
          archived_at: string | null
          created_at: string
          id: string
          name: string
          status: Database["public"]["Enums"]["garden_status"]
          tenant_id: string
          updated_at: string
        }
        Insert: {
          archived_at?: string | null
          created_at?: string
          id?: string
          name: string
          status?: Database["public"]["Enums"]["garden_status"]
          tenant_id?: string
          updated_at?: string
        }
        Update: {
          archived_at?: string | null
          created_at?: string
          id?: string
          name?: string
          status?: Database["public"]["Enums"]["garden_status"]
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "gardens_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      plots: {
        Row: {
          ai_enabled: boolean
          archived_at: string | null
          created_at: string
          cross_pollinate: boolean
          garden_id: string
          id: string
          name: string
          permission_version: number
          tenant_id: string
        }
        Insert: {
          ai_enabled?: boolean
          archived_at?: string | null
          created_at?: string
          cross_pollinate?: boolean
          garden_id: string
          id?: string
          name: string
          permission_version?: number
          tenant_id?: string
        }
        Update: {
          ai_enabled?: boolean
          archived_at?: string | null
          created_at?: string
          cross_pollinate?: boolean
          garden_id?: string
          id?: string
          name?: string
          permission_version?: number
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "plots_garden_id_tenant_id_fkey"
            columns: ["garden_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "gardens"
            referencedColumns: ["id", "tenant_id"]
          },
        ]
      }
      seed_revisions: {
        Row: {
          body: string
          created_at: string
          created_by: string
          entry_id: string
          garden_id: string
          id: string
          revision_number: number
          seed_id: string
          tenant_id: string
        }
        Insert: {
          body: string
          created_at?: string
          created_by?: string
          entry_id: string
          garden_id: string
          id?: string
          revision_number: number
          seed_id: string
          tenant_id?: string
        }
        Update: {
          body?: string
          created_at?: string
          created_by?: string
          entry_id?: string
          garden_id?: string
          id?: string
          revision_number?: number
          seed_id?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "seed_revisions_entry_id_seed_id_tenant_id_garden_id_fkey"
            columns: ["entry_id", "seed_id", "tenant_id", "garden_id"]
            isOneToOne: false
            referencedRelation: "entries"
            referencedColumns: ["id", "seed_id", "tenant_id", "garden_id"]
          },
          {
            foreignKeyName: "seed_revisions_seed_tenant_fk"
            columns: ["seed_id", "tenant_id", "garden_id"]
            isOneToOne: false
            referencedRelation: "seeds"
            referencedColumns: ["id", "tenant_id", "garden_id"]
          },
        ]
      }
      seeds: {
        Row: {
          archived_at: string | null
          created_at: string
          garden_id: string
          id: string
          plot_id: string
          position_x: number
          position_y: number
          status: Database["public"]["Enums"]["seed_status"]
          tenant_id: string
          title: string
          updated_at: string
        }
        Insert: {
          archived_at?: string | null
          created_at?: string
          garden_id: string
          id?: string
          plot_id: string
          position_x?: number
          position_y?: number
          status?: Database["public"]["Enums"]["seed_status"]
          tenant_id?: string
          title?: string
          updated_at?: string
        }
        Update: {
          archived_at?: string | null
          created_at?: string
          garden_id?: string
          id?: string
          plot_id?: string
          position_x?: number
          position_y?: number
          status?: Database["public"]["Enums"]["seed_status"]
          tenant_id?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "seeds_garden_tenant_fk"
            columns: ["garden_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "gardens"
            referencedColumns: ["id", "tenant_id"]
          },
          {
            foreignKeyName: "seeds_plot_id_tenant_id_garden_id_fkey"
            columns: ["plot_id", "tenant_id", "garden_id"]
            isOneToOne: false
            referencedRelation: "plots"
            referencedColumns: ["id", "tenant_id", "garden_id"]
          },
        ]
      }
    }
    Views: {
      current_entries: {
        Row: {
          archived_at: string | null
          body: string | null
          created_at: string | null
          entry_id: string | null
          garden_id: string | null
          revised_at: string | null
          revision_id: string | null
          revision_number: number | null
          seed_id: string | null
          tenant_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "seed_revisions_entry_id_seed_id_tenant_id_garden_id_fkey"
            columns: ["entry_id", "seed_id", "tenant_id", "garden_id"]
            isOneToOne: false
            referencedRelation: "entries"
            referencedColumns: ["id", "seed_id", "tenant_id", "garden_id"]
          },
          {
            foreignKeyName: "seed_revisions_seed_tenant_fk"
            columns: ["seed_id", "tenant_id", "garden_id"]
            isOneToOne: false
            referencedRelation: "seeds"
            referencedColumns: ["id", "tenant_id", "garden_id"]
          },
        ]
      }
    }
    Functions: {
      check_garden_pass: {
        Args: { p_id: string; p_token: string }
        Returns: boolean
      }
      claim_garden_pass: { Args: never; Returns: Json }
      create_seed: {
        Args: {
          p_body: string
          p_garden_id: string
          p_position_x?: number
          p_position_y?: number
        }
        Returns: string
      }
      export_garden_sources: { Args: never; Returns: Json }
      finish_garden_pass: {
        Args: {
          p_failed?: boolean
          p_id: string
          p_input_tokens?: number
          p_output_tokens?: number
          p_result: Json
          p_token: string
        }
        Returns: undefined
      }
      save_entry: {
        Args: {
          p_body: string
          p_entry_id: string
          p_expected_revision_id?: string
          p_revision_id: string
          p_seed_id: string
        }
        Returns: string
      }
      update_garden_job: {
        Args: {
          p_clean?: boolean
          p_id: string
          p_input_file?: string
          p_output_file?: string
          p_provider?: string
          p_release?: boolean
          p_token: string
        }
        Returns: undefined
      }
    }
    Enums: {
      garden_status: "active" | "archived"
      seed_status: "active" | "archived"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      garden_status: ["active", "archived"],
      seed_status: ["active", "archived"],
    },
  },
} as const
