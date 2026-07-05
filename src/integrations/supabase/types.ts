export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      characters: {
        Row: {
          age: number | null
          cover_url: string | null
          created_at: string | null
          debut_shot: string | null
          gradient: string | null
          id: string
          images: Json | null
          key_prop: string | null
          look: string | null
          mbti: string | null
          motivation: string | null
          name: string
          palette: string[] | null
          personality: string | null
          role: string
          role_label: string | null
          user_id: string
        }
        Insert: {
          age?: number | null
          cover_url?: string | null
          created_at?: string | null
          debut_shot?: string | null
          gradient?: string | null
          id: string
          images?: Json | null
          key_prop?: string | null
          look?: string | null
          mbti?: string | null
          motivation?: string | null
          name: string
          palette?: string[] | null
          personality?: string | null
          role?: string
          role_label?: string | null
          user_id: string
        }
        Update: {
          age?: number | null
          cover_url?: string | null
          created_at?: string | null
          debut_shot?: string | null
          gradient?: string | null
          id?: string
          images?: Json | null
          key_prop?: string | null
          look?: string | null
          mbti?: string | null
          motivation?: string | null
          name?: string
          palette?: string[] | null
          personality?: string | null
          role?: string
          role_label?: string | null
          user_id?: string
        }
        Relationships: []
      }
      community_posts: {
        Row: {
          cover_gradient: string | null
          created_at: string
          id: string
          kind: string
          likes_count: number
          payload: Json
          source_id: string | null
          summary: string | null
          title: string
          updated_at: string
          user_id: string
          views_count: number
          visibility: string
        }
        Insert: {
          cover_gradient?: string | null
          created_at?: string
          id?: string
          kind: string
          likes_count?: number
          payload?: Json
          source_id?: string | null
          summary?: string | null
          title?: string
          updated_at?: string
          user_id: string
          views_count?: number
          visibility?: string
        }
        Update: {
          cover_gradient?: string | null
          created_at?: string
          id?: string
          kind?: string
          likes_count?: number
          payload?: Json
          source_id?: string | null
          summary?: string | null
          title?: string
          updated_at?: string
          user_id?: string
          views_count?: number
          visibility?: string
        }
        Relationships: []
      }
      credit_transactions: {
        Row: {
          amount: number
          balance_after: number | null
          created_at: string
          description: string | null
          id: string
          operator_id: string | null
          source_type: string
          team_id: string
          type: string
          user_id: string
        }
        Insert: {
          amount: number
          balance_after?: number | null
          created_at?: string
          description?: string | null
          id?: string
          operator_id?: string | null
          source_type?: string
          team_id: string
          type: string
          user_id: string
        }
        Update: {
          amount?: number
          balance_after?: number | null
          created_at?: string
          description?: string | null
          id?: string
          operator_id?: string | null
          source_type?: string
          team_id?: string
          type?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "credit_transactions_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      password_audit_log: {
        Row: {
          action: string
          created_at: string
          id: string
          ip_address: string | null
          metadata: Json
          user_agent: string | null
          user_id: string
        }
        Insert: {
          action: string
          created_at?: string
          id?: string
          ip_address?: string | null
          metadata?: Json
          user_agent?: string | null
          user_id: string
        }
        Update: {
          action?: string
          created_at?: string
          id?: string
          ip_address?: string | null
          metadata?: Json
          user_agent?: string | null
          user_id?: string
        }
        Relationships: []
      }
      post_likes: {
        Row: {
          created_at: string
          post_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          post_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          post_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "post_likes_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "community_posts"
            referencedColumns: ["id"]
          },
        ]
      }
      post_views: {
        Row: {
          created_at: string
          id: string
          post_id: string
          viewed_on: string
          viewer_key: string
        }
        Insert: {
          created_at?: string
          id?: string
          post_id: string
          viewed_on?: string
          viewer_key: string
        }
        Update: {
          created_at?: string
          id?: string
          post_id?: string
          viewed_on?: string
          viewer_key?: string
        }
        Relationships: [
          {
            foreignKeyName: "post_views_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "community_posts"
            referencedColumns: ["id"]
          },
        ]
      }
      projects: {
        Row: {
          aspect: string
          audio: string
          completed_stages: string[]
          created_at: string
          custom_cover: string | null
          id: string
          name: string
          scene_model: string
          storyboard_model: string
          style: string
          updated_at: string
          user_id: string
          video_model: string
          workflow: string
          workspace_data: Json
        }
        Insert: {
          aspect?: string
          audio?: string
          completed_stages?: string[]
          created_at?: string
          custom_cover?: string | null
          id: string
          name?: string
          scene_model?: string
          storyboard_model?: string
          style?: string
          updated_at?: string
          user_id: string
          video_model?: string
          workflow?: string
          workspace_data?: Json
        }
        Update: {
          aspect?: string
          audio?: string
          completed_stages?: string[]
          created_at?: string
          custom_cover?: string | null
          id?: string
          name?: string
          scene_model?: string
          storyboard_model?: string
          style?: string
          updated_at?: string
          user_id?: string
          video_model?: string
          workflow?: string
          workspace_data?: Json
        }
        Relationships: []
      }
      props: {
        Row: {
          cover_url: string | null
          created_at: string
          description: string | null
          episode_index: number
          id: string
          images: Json | null
          key_moments: string[] | null
          movement_description: string | null
          name: string
          palette: string[] | null
          updated_at: string
          user_id: string
        }
        Insert: {
          cover_url?: string | null
          created_at?: string
          description?: string | null
          episode_index?: number
          id: string
          images?: Json | null
          key_moments?: string[] | null
          movement_description?: string | null
          name: string
          palette?: string[] | null
          updated_at?: string
          user_id: string
        }
        Update: {
          cover_url?: string | null
          created_at?: string
          description?: string | null
          episode_index?: number
          id?: string
          images?: Json | null
          key_moments?: string[] | null
          movement_description?: string | null
          name?: string
          palette?: string[] | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      scenes: {
        Row: {
          action: string | null
          beats: string[] | null
          cover_url: string | null
          created_at: string | null
          dialogue: Json | null
          gradient: string | null
          id: string
          location: string | null
          name: string
          time_of_day: string | null
          user_id: string
        }
        Insert: {
          action?: string | null
          beats?: string[] | null
          cover_url?: string | null
          created_at?: string | null
          dialogue?: Json | null
          gradient?: string | null
          id: string
          location?: string | null
          name: string
          time_of_day?: string | null
          user_id: string
        }
        Update: {
          action?: string | null
          beats?: string[] | null
          cover_url?: string | null
          created_at?: string | null
          dialogue?: Json | null
          gradient?: string | null
          id?: string
          location?: string | null
          name?: string
          time_of_day?: string | null
          user_id?: string
        }
        Relationships: []
      }
      scripts: {
        Row: {
          created_at: string
          genre: string | null
          id: string
          payload: Json
          title: string
          tone: string | null
          type: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          genre?: string | null
          id: string
          payload: Json
          title?: string
          tone?: string | null
          type?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          genre?: string | null
          id?: string
          payload?: Json
          title?: string
          tone?: string | null
          type?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      team_members: {
        Row: {
          credits_balance: number
          id: string
          invited_by: string | null
          joined_at: string
          role: string
          subscription_credits: number
          team_id: string
          user_id: string
        }
        Insert: {
          credits_balance?: number
          id?: string
          invited_by?: string | null
          joined_at?: string
          role?: string
          subscription_credits?: number
          team_id: string
          user_id: string
        }
        Update: {
          credits_balance?: number
          id?: string
          invited_by?: string | null
          joined_at?: string
          role?: string
          subscription_credits?: number
          team_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "team_members_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      teams: {
        Row: {
          created_at: string
          deleted_at: string | null
          description: string | null
          id: string
          name: string
          owner_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          deleted_at?: string | null
          description?: string | null
          id?: string
          name: string
          owner_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          deleted_at?: string | null
          description?: string | null
          id?: string
          name?: string
          owner_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      transfer_records: {
        Row: {
          amount: number
          created_at: string
          from_balance_after: number | null
          from_user_id: string
          id: string
          operator_id: string | null
          team_id: string
          to_balance_after: number | null
          to_user_id: string
        }
        Insert: {
          amount: number
          created_at?: string
          from_balance_after?: number | null
          from_user_id: string
          id?: string
          operator_id?: string | null
          team_id: string
          to_balance_after?: number | null
          to_user_id: string
        }
        Update: {
          amount?: number
          created_at?: string
          from_balance_after?: number | null
          from_user_id?: string
          id?: string
          operator_id?: string | null
          team_id?: string
          to_balance_after?: number | null
          to_user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "transfer_records_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      user_wallets: {
        Row: {
          created_at: string
          credits_balance: number
          id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          credits_balance?: number
          id?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          credits_balance?: number
          id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      add_user_credits: { Args: { p_amount: number }; Returns: undefined }
      dissolve_team_with_refund: {
        Args: { p_team_id: string }
        Returns: undefined
      }
      get_team_member_profiles: {
        Args: { p_user_ids: string[] }
        Returns: {
          email: string
          raw_user_meta_data: Json
          user_id: string
        }[]
      }
      has_team_role: {
        Args: { p_roles: string[]; p_team_id: string; p_user_id?: string }
        Returns: boolean
      }
      is_in_team: {
        Args: { p_team_id: string; p_user_id?: string }
        Returns: boolean
      }
    }
    Enums: {
      [_ in never]: never
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
    Enums: {},
  },
} as const
