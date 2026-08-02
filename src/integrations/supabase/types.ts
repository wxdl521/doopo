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
      admin_users: {
        Row: {
          created_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          user_id?: string
        }
        Relationships: []
      }
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
          reference_audio_url: string | null
          role: string
          role_label: string | null
          updated_at: string
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
          reference_audio_url?: string | null
          role?: string
          role_label?: string | null
          updated_at?: string
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
          reference_audio_url?: string | null
          role?: string
          role_label?: string | null
          updated_at?: string
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
      generation_error_logs: {
        Row: {
          created_at: string
          duration_ms: number | null
          error_message: string | null
          id: string
          kind: string
          model: string | null
          provider: string
          request_payload: Json | null
          response_body: string | null
          status: number | null
          user_id: string | null
        }
        Insert: {
          created_at?: string
          duration_ms?: number | null
          error_message?: string | null
          id?: string
          kind: string
          model?: string | null
          provider: string
          request_payload?: Json | null
          response_body?: string | null
          status?: number | null
          user_id?: string | null
        }
        Update: {
          created_at?: string
          duration_ms?: number | null
          error_message?: string | null
          id?: string
          kind?: string
          model?: string | null
          provider?: string
          request_payload?: Json | null
          response_body?: string | null
          status?: number | null
          user_id?: string | null
        }
        Relationships: []
      }
      model_pricing: {
        Row: {
          created_at: string | null
          credits: number
          enabled: boolean
          id: string
          is_default: boolean
          kind: string
          label: string
          model_id: string
          note: string | null
          resolution: string | null
          sort_order: number
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          credits: number
          enabled?: boolean
          id?: string
          is_default?: boolean
          kind: string
          label: string
          model_id: string
          note?: string | null
          resolution?: string | null
          sort_order?: number
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          credits?: number
          enabled?: boolean
          id?: string
          is_default?: boolean
          kind?: string
          label?: string
          model_id?: string
          note?: string | null
          resolution?: string | null
          sort_order?: number
          updated_at?: string | null
        }
        Relationships: []
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
          character_nationality: string
          completed_stages: string[]
          created_at: string
          custom_cover: string | null
          custom_style: string | null
          group_id: string | null
          id: string
          name: string
          resolution: string | null
          scene_model: string
          storyboard_model: string
          style: string
          team_id: string | null
          updated_at: string
          user_id: string
          video_model: string
          workflow: string
          workspace_data: Json
        }
        Insert: {
          aspect?: string
          audio?: string
          character_nationality?: string
          completed_stages?: string[]
          created_at?: string
          custom_cover?: string | null
          custom_style?: string | null
          group_id?: string | null
          id: string
          name?: string
          resolution?: string | null
          scene_model?: string
          storyboard_model?: string
          style?: string
          team_id?: string | null
          updated_at?: string
          user_id: string
          video_model?: string
          workflow?: string
          workspace_data?: Json
        }
        Update: {
          aspect?: string
          audio?: string
          character_nationality?: string
          completed_stages?: string[]
          created_at?: string
          custom_cover?: string | null
          custom_style?: string | null
          group_id?: string | null
          id?: string
          name?: string
          resolution?: string | null
          scene_model?: string
          storyboard_model?: string
          style?: string
          team_id?: string | null
          updated_at?: string
          user_id?: string
          video_model?: string
          workflow?: string
          workspace_data?: Json
        }
        Relationships: [
          {
            foreignKeyName: "projects_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "team_groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "projects_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
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
      restyle_artifacts: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          content: Json | null
          created_at: string | null
          id: string
          issues: Json | null
          node_key: string
          project_id: string
          revision: number
          scope_hash: string | null
          stage: string
          status: string
          updated_at: string | null
          user_content: Json | null
          user_id: string
          verdict: string | null
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          content?: Json | null
          created_at?: string | null
          id: string
          issues?: Json | null
          node_key: string
          project_id: string
          revision?: number
          scope_hash?: string | null
          stage: string
          status?: string
          updated_at?: string | null
          user_content?: Json | null
          user_id: string
          verdict?: string | null
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          content?: Json | null
          created_at?: string | null
          id?: string
          issues?: Json | null
          node_key?: string
          project_id?: string
          revision?: number
          scope_hash?: string | null
          stage?: string
          status?: string
          updated_at?: string | null
          user_content?: Json | null
          user_id?: string
          verdict?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "restyle_artifacts_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "restyle_projects"
            referencedColumns: ["id"]
          },
        ]
      }
      restyle_character_looks: {
        Row: {
          back_url: string | null
          character_id: string
          created_at: string | null
          from_shot: string | null
          front_url: string | null
          id: string
          image_url: string | null
          name: string
          redesign_reason: string | null
          reuse_existing: boolean | null
          reuse_source: string | null
          side_url: string | null
          to_shot: string | null
          user_id: string
        }
        Insert: {
          back_url?: string | null
          character_id: string
          created_at?: string | null
          from_shot?: string | null
          front_url?: string | null
          id: string
          image_url?: string | null
          name: string
          redesign_reason?: string | null
          reuse_existing?: boolean | null
          reuse_source?: string | null
          side_url?: string | null
          to_shot?: string | null
          user_id: string
        }
        Update: {
          back_url?: string | null
          character_id?: string
          created_at?: string | null
          from_shot?: string | null
          front_url?: string | null
          id?: string
          image_url?: string | null
          name?: string
          redesign_reason?: string | null
          reuse_existing?: boolean | null
          reuse_source?: string | null
          side_url?: string | null
          to_shot?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "restyle_character_looks_character_id_fkey"
            columns: ["character_id"]
            isOneToOne: false
            referencedRelation: "restyle_characters"
            referencedColumns: ["id"]
          },
        ]
      }
      restyle_character_relations: {
        Row: {
          character_id: string
          created_at: string | null
          id: string
          related_character_id: string
          relation: string
          user_id: string
        }
        Insert: {
          character_id: string
          created_at?: string | null
          id: string
          related_character_id: string
          relation: string
          user_id: string
        }
        Update: {
          character_id?: string
          created_at?: string | null
          id?: string
          related_character_id?: string
          relation?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "restyle_character_relations_character_id_fkey"
            columns: ["character_id"]
            isOneToOne: false
            referencedRelation: "restyle_characters"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "restyle_character_relations_related_character_id_fkey"
            columns: ["related_character_id"]
            isOneToOne: false
            referencedRelation: "restyle_characters"
            referencedColumns: ["id"]
          },
        ]
      }
      restyle_characters: {
        Row: {
          asset_origin: Json | null
          clothing: string | null
          created_at: string | null
          description: string | null
          id: string
          identity_lock: string | null
          main_image_url: string | null
          name: string
          project_id: string
          source_description: string | null
          status: string
          turnaround_url: string | null
          updated_at: string | null
          user_id: string
          voice_profile: Json | null
        }
        Insert: {
          asset_origin?: Json | null
          clothing?: string | null
          created_at?: string | null
          description?: string | null
          id: string
          identity_lock?: string | null
          main_image_url?: string | null
          name: string
          project_id: string
          source_description?: string | null
          status?: string
          turnaround_url?: string | null
          updated_at?: string | null
          user_id: string
          voice_profile?: Json | null
        }
        Update: {
          asset_origin?: Json | null
          clothing?: string | null
          created_at?: string | null
          description?: string | null
          id?: string
          identity_lock?: string | null
          main_image_url?: string | null
          name?: string
          project_id?: string
          source_description?: string | null
          status?: string
          turnaround_url?: string | null
          updated_at?: string | null
          user_id?: string
          voice_profile?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "restyle_characters_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "restyle_projects"
            referencedColumns: ["id"]
          },
        ]
      }
      restyle_episodes: {
        Row: {
          analysis_error: string | null
          analysis_json: Json | null
          analysis_status: string
          analysis_units: Json | null
          created_at: string | null
          duration_sec: number | null
          episode_no: number
          id: string
          project_id: string
          review_status: string
          source_media_url: string | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          analysis_error?: string | null
          analysis_json?: Json | null
          analysis_status?: string
          analysis_units?: Json | null
          created_at?: string | null
          duration_sec?: number | null
          episode_no: number
          id: string
          project_id: string
          review_status?: string
          source_media_url?: string | null
          updated_at?: string | null
          user_id: string
        }
        Update: {
          analysis_error?: string | null
          analysis_json?: Json | null
          analysis_status?: string
          analysis_units?: Json | null
          created_at?: string | null
          duration_sec?: number | null
          episode_no?: number
          id?: string
          project_id?: string
          review_status?: string
          source_media_url?: string | null
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "restyle_episodes_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "restyle_projects"
            referencedColumns: ["id"]
          },
        ]
      }
      restyle_groups: {
        Row: {
          created_at: string | null
          episode_id: string
          group_no: number
          id: string
          reason: string | null
          scope_hash: string | null
          shot_ids: string[]
          status: string
          total_seconds: number
          user_id: string
        }
        Insert: {
          created_at?: string | null
          episode_id: string
          group_no: number
          id: string
          reason?: string | null
          scope_hash?: string | null
          shot_ids?: string[]
          status?: string
          total_seconds: number
          user_id: string
        }
        Update: {
          created_at?: string | null
          episode_id?: string
          group_no?: number
          id?: string
          reason?: string | null
          scope_hash?: string | null
          shot_ids?: string[]
          status?: string
          total_seconds?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "restyle_groups_episode_id_fkey"
            columns: ["episode_id"]
            isOneToOne: false
            referencedRelation: "restyle_episodes"
            referencedColumns: ["id"]
          },
        ]
      }
      restyle_ignored_assets: {
        Row: {
          created_at: string | null
          id: string
          kind: string
          name: string
          project_id: string
          reason: string | null
          user_id: string
        }
        Insert: {
          created_at?: string | null
          id: string
          kind: string
          name: string
          project_id: string
          reason?: string | null
          user_id: string
        }
        Update: {
          created_at?: string | null
          id?: string
          kind?: string
          name?: string
          project_id?: string
          reason?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "restyle_ignored_assets_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "restyle_projects"
            referencedColumns: ["id"]
          },
        ]
      }
      restyle_projects: {
        Row: {
          aspect: string | null
          asset_image_source: string | null
          auto_budget: number | null
          created_at: string | null
          execution_mode: string | null
          id: string
          image_model: string | null
          manual_gates: Json | null
          stage: string
          style_brief: string | null
          text_model: string | null
          title: string
          updated_at: string | null
          user_id: string
          video_model: string | null
          vision_model: string | null
          voice_source: string | null
        }
        Insert: {
          aspect?: string | null
          asset_image_source?: string | null
          auto_budget?: number | null
          created_at?: string | null
          execution_mode?: string | null
          id: string
          image_model?: string | null
          manual_gates?: Json | null
          stage?: string
          style_brief?: string | null
          text_model?: string | null
          title: string
          updated_at?: string | null
          user_id: string
          video_model?: string | null
          vision_model?: string | null
          voice_source?: string | null
        }
        Update: {
          aspect?: string | null
          asset_image_source?: string | null
          auto_budget?: number | null
          created_at?: string | null
          execution_mode?: string | null
          id?: string
          image_model?: string | null
          manual_gates?: Json | null
          stage?: string
          style_brief?: string | null
          text_model?: string | null
          title?: string
          updated_at?: string | null
          user_id?: string
          video_model?: string | null
          vision_model?: string | null
          voice_source?: string | null
        }
        Relationships: []
      }
      restyle_props: {
        Row: {
          asset_origin: Json | null
          created_at: string | null
          description: string | null
          id: string
          image_url: string | null
          name: string
          project_id: string
          prompt: string | null
          source_description: string | null
          status: string
          user_id: string
        }
        Insert: {
          asset_origin?: Json | null
          created_at?: string | null
          description?: string | null
          id: string
          image_url?: string | null
          name: string
          project_id: string
          prompt?: string | null
          source_description?: string | null
          status?: string
          user_id: string
        }
        Update: {
          asset_origin?: Json | null
          created_at?: string | null
          description?: string | null
          id?: string
          image_url?: string | null
          name?: string
          project_id?: string
          prompt?: string | null
          source_description?: string | null
          status?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "restyle_props_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "restyle_projects"
            referencedColumns: ["id"]
          },
        ]
      }
      restyle_reviews: {
        Row: {
          created_at: string | null
          description: string | null
          doc_kind: string
          episode_id: string | null
          id: string
          issue_type: string | null
          project_id: string
          risk: string | null
          severity: string | null
          status: string
          suggestion: string | null
          user_id: string
        }
        Insert: {
          created_at?: string | null
          description?: string | null
          doc_kind: string
          episode_id?: string | null
          id: string
          issue_type?: string | null
          project_id: string
          risk?: string | null
          severity?: string | null
          status?: string
          suggestion?: string | null
          user_id: string
        }
        Update: {
          created_at?: string | null
          description?: string | null
          doc_kind?: string
          episode_id?: string | null
          id?: string
          issue_type?: string | null
          project_id?: string
          risk?: string | null
          severity?: string | null
          status?: string
          suggestion?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "restyle_reviews_episode_id_fkey"
            columns: ["episode_id"]
            isOneToOne: false
            referencedRelation: "restyle_episodes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "restyle_reviews_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "restyle_projects"
            referencedColumns: ["id"]
          },
        ]
      }
      restyle_scenes: {
        Row: {
          asset_origin: Json | null
          created_at: string | null
          description: string | null
          id: string
          image_url: string | null
          name: string
          project_id: string
          prompt: string | null
          source_description: string | null
          status: string
          user_id: string
        }
        Insert: {
          asset_origin?: Json | null
          created_at?: string | null
          description?: string | null
          id: string
          image_url?: string | null
          name: string
          project_id: string
          prompt?: string | null
          source_description?: string | null
          status?: string
          user_id: string
        }
        Update: {
          asset_origin?: Json | null
          created_at?: string | null
          description?: string | null
          id?: string
          image_url?: string | null
          name?: string
          project_id?: string
          prompt?: string | null
          source_description?: string | null
          status?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "restyle_scenes_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "restyle_projects"
            referencedColumns: ["id"]
          },
        ]
      }
      restyle_segments: {
        Row: {
          created_at: string | null
          group_id: string
          id: string
          postcheck: Json | null
          precheck: Json | null
          prompt_pack: Json | null
          render_status: string
          render_task_id: string | null
          result_url: string | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          created_at?: string | null
          group_id: string
          id: string
          postcheck?: Json | null
          precheck?: Json | null
          prompt_pack?: Json | null
          render_status?: string
          render_task_id?: string | null
          result_url?: string | null
          updated_at?: string | null
          user_id: string
        }
        Update: {
          created_at?: string | null
          group_id?: string
          id?: string
          postcheck?: Json | null
          precheck?: Json | null
          prompt_pack?: Json | null
          render_status?: string
          render_task_id?: string | null
          result_url?: string | null
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "restyle_segments_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "restyle_groups"
            referencedColumns: ["id"]
          },
        ]
      }
      restyle_shots: {
        Row: {
          characters: Json | null
          created_at: string | null
          dialogue: string | null
          emotion: string | null
          end_ms: number
          end_state_action: string | null
          episode_id: string
          id: string
          props: Json | null
          scene_type: string | null
          set_ref: string | null
          shot_no: string
          shot_type: string | null
          sound_effects: string | null
          spatial_anchor: string | null
          start_ms: number
          use_new_set: boolean | null
          user_id: string
          voice_type: string | null
        }
        Insert: {
          characters?: Json | null
          created_at?: string | null
          dialogue?: string | null
          emotion?: string | null
          end_ms: number
          end_state_action?: string | null
          episode_id: string
          id: string
          props?: Json | null
          scene_type?: string | null
          set_ref?: string | null
          shot_no: string
          shot_type?: string | null
          sound_effects?: string | null
          spatial_anchor?: string | null
          start_ms: number
          use_new_set?: boolean | null
          user_id: string
          voice_type?: string | null
        }
        Update: {
          characters?: Json | null
          created_at?: string | null
          dialogue?: string | null
          emotion?: string | null
          end_ms?: number
          end_state_action?: string | null
          episode_id?: string
          id?: string
          props?: Json | null
          scene_type?: string | null
          set_ref?: string | null
          shot_no?: string
          shot_type?: string | null
          sound_effects?: string | null
          spatial_anchor?: string | null
          start_ms?: number
          use_new_set?: boolean | null
          user_id?: string
          voice_type?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "restyle_shots_episode_id_fkey"
            columns: ["episode_id"]
            isOneToOne: false
            referencedRelation: "restyle_episodes"
            referencedColumns: ["id"]
          },
        ]
      }
      restyle_source_assets: {
        Row: {
          aliases: Json | null
          appearance: string | null
          created_at: string | null
          description: string | null
          episode_id: string
          first_seen_ms: number | null
          id: string
          kind: string
          last_seen_ms: number | null
          relationships: Json | null
          source_name: string
          uncertainty: Json | null
          user_id: string
          wardrobe: string | null
        }
        Insert: {
          aliases?: Json | null
          appearance?: string | null
          created_at?: string | null
          description?: string | null
          episode_id: string
          first_seen_ms?: number | null
          id: string
          kind: string
          last_seen_ms?: number | null
          relationships?: Json | null
          source_name: string
          uncertainty?: Json | null
          user_id: string
          wardrobe?: string | null
        }
        Update: {
          aliases?: Json | null
          appearance?: string | null
          created_at?: string | null
          description?: string | null
          episode_id?: string
          first_seen_ms?: number | null
          id?: string
          kind?: string
          last_seen_ms?: number | null
          relationships?: Json | null
          source_name?: string
          uncertainty?: Json | null
          user_id?: string
          wardrobe?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "restyle_source_assets_episode_id_fkey"
            columns: ["episode_id"]
            isOneToOne: false
            referencedRelation: "restyle_episodes"
            referencedColumns: ["id"]
          },
        ]
      }
      restyle_transcripts: {
        Row: {
          begin_ms: number
          confidence: number | null
          created_at: string | null
          end_ms: number
          episode_id: string
          id: string
          sentence_id: string | null
          speaker: string | null
          text: string
          unit_id: string | null
          user_id: string
        }
        Insert: {
          begin_ms: number
          confidence?: number | null
          created_at?: string | null
          end_ms: number
          episode_id: string
          id: string
          sentence_id?: string | null
          speaker?: string | null
          text: string
          unit_id?: string | null
          user_id: string
        }
        Update: {
          begin_ms?: number
          confidence?: number | null
          created_at?: string | null
          end_ms?: number
          episode_id?: string
          id?: string
          sentence_id?: string | null
          speaker?: string | null
          text?: string
          unit_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "restyle_transcripts_episode_id_fkey"
            columns: ["episode_id"]
            isOneToOne: false
            referencedRelation: "restyle_episodes"
            referencedColumns: ["id"]
          },
        ]
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
          images: Json
          location: string | null
          name: string
          time_of_day: string | null
          updated_at: string
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
          images?: Json
          location?: string | null
          name: string
          time_of_day?: string | null
          updated_at?: string
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
          images?: Json
          location?: string | null
          name?: string
          time_of_day?: string | null
          updated_at?: string
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
      team_groups: {
        Row: {
          admin_id: string | null
          created_at: string
          id: string
          name: string
          team_id: string
        }
        Insert: {
          admin_id?: string | null
          created_at?: string
          id?: string
          name: string
          team_id: string
        }
        Update: {
          admin_id?: string | null
          created_at?: string
          id?: string
          name?: string
          team_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "team_groups_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      team_members: {
        Row: {
          credits_balance: number
          group_id: string | null
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
          group_id?: string | null
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
          group_id?: string | null
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
            foreignKeyName: "team_members_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "team_groups"
            referencedColumns: ["id"]
          },
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
      user_credit_transactions: {
        Row: {
          amount: number
          balance_after: number | null
          created_at: string
          description: string | null
          duration: number | null
          id: string
          model: string | null
          resolution: string | null
          type: string
          user_id: string
        }
        Insert: {
          amount: number
          balance_after?: number | null
          created_at?: string
          description?: string | null
          duration?: number | null
          id?: string
          model?: string | null
          resolution?: string | null
          type?: string
          user_id: string
        }
        Update: {
          amount?: number
          balance_after?: number | null
          created_at?: string
          description?: string | null
          duration?: number | null
          id?: string
          model?: string | null
          resolution?: string | null
          type?: string
          user_id?: string
        }
        Relationships: []
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
      add_user_credits:
        | {
            Args: { p_amount: number }
            Returns: {
              error: true
            } & "Could not choose the best candidate function between: public.add_user_credits(p_amount => int4), public.add_user_credits(p_amount => numeric). Try renaming the parameters or the function itself in the database so function overloading can be resolved"
          }
        | {
            Args: { p_amount: number }
            Returns: {
              error: true
            } & "Could not choose the best candidate function between: public.add_user_credits(p_amount => int4), public.add_user_credits(p_amount => numeric). Try renaming the parameters or the function itself in the database so function overloading can be resolved"
          }
      admin_grant_credits: {
        Args: {
          p_amount: number
          p_description?: string
          p_target_id: string
          p_target_type: string
        }
        Returns: {
          balance_after: number
        }[]
      }
      admin_list_credit_recipients: {
        Args: {
          p_kind: string
          p_page?: number
          p_page_size?: number
          p_query?: string
        }
        Returns: {
          balance: number
          created_at: string
          email: string
          name: string
          target_id: string
          target_type: string
          total_count: number
        }[]
      }
      allocate_team_credits: {
        Args: {
          p_amount: number
          p_description?: string
          p_team_id: string
          p_user_id: string
        }
        Returns: number
      }
      assert_credit_admin: { Args: never; Returns: undefined }
      create_team_as_owner: {
        Args: { p_credits?: number; p_description?: string; p_name: string }
        Returns: string
      }
      deduct_user_credits: {
        Args: {
          p_amount: number
          p_description: string
          p_duration: number
          p_model: string
          p_resolution: string
        }
        Returns: {
          balance_after: number
          ok: boolean
        }[]
      }
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
      get_team_public_info: {
        Args: { p_team_id: string }
        Returns: {
          created_at: string
          description: string
          id: string
          name: string
          owner_id: string
        }[]
      }
      has_team_role: {
        Args: { p_roles: string[]; p_team_id: string; p_user_id?: string }
        Returns: boolean
      }
      is_credit_admin: { Args: never; Returns: boolean }
      is_in_same_group: {
        Args: { p_group_id: string; p_user_id?: string }
        Returns: boolean
      }
      is_in_team: {
        Args: { p_team_id: string; p_user_id?: string }
        Returns: boolean
      }
      join_team_as_self: { Args: { p_team_id: string }; Returns: undefined }
      reclaim_team_credits: {
        Args: {
          p_amount: number
          p_description?: string
          p_team_id: string
          p_user_id: string
        }
        Returns: number
      }
      transfer_team_credits: {
        Args: {
          p_amount: number
          p_description?: string
          p_team_id: string
          p_to_user_id: string
        }
        Returns: {
          from_balance_after: number
          to_balance_after: number
        }[]
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
