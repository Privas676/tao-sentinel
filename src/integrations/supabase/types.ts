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
    PostgrestVersion: "14.1"
  }
  public: {
    Tables: {
      events: {
        Row: {
          evidence: Json | null
          id: number
          netuid: number | null
          severity: number | null
          ts: string | null
          type: string | null
        }
        Insert: {
          evidence?: Json | null
          id?: number
          netuid?: number | null
          severity?: number | null
          ts?: string | null
          type?: string | null
        }
        Update: {
          evidence?: Json | null
          id?: number
          netuid?: number | null
          severity?: number | null
          ts?: string | null
          type?: string | null
        }
        Relationships: []
      }
      fx_rates: {
        Row: {
          tao_usd: number
          ts: string
        }
        Insert: {
          tao_usd: number
          ts: string
        }
        Update: {
          tao_usd?: number
          ts?: string
        }
        Relationships: []
      }
      positions: {
        Row: {
          capital: number
          closed_at: string | null
          closed_price: number | null
          created_at: string
          entry_price: number
          id: string
          netuid: number
          quantity: number
          status: string
          stop_loss_pct: number
          take_profit_pct: number
          updated_at: string
          user_id: string
        }
        Insert: {
          capital: number
          closed_at?: string | null
          closed_price?: number | null
          created_at?: string
          entry_price: number
          id?: string
          netuid: number
          quantity: number
          status?: string
          stop_loss_pct?: number
          take_profit_pct?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          capital?: number
          closed_at?: string | null
          closed_price?: number | null
          created_at?: string
          entry_price?: number
          id?: string
          netuid?: number
          quantity?: number
          status?: string
          stop_loss_pct?: number
          take_profit_pct?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "positions_netuid_fkey"
            columns: ["netuid"]
            isOneToOne: false
            referencedRelation: "subnets"
            referencedColumns: ["netuid"]
          },
        ]
      }
      push_config: {
        Row: {
          created_at: string
          id: number
          vapid_private_key: string
          vapid_public_key: string
        }
        Insert: {
          created_at?: string
          id?: number
          vapid_private_key: string
          vapid_public_key: string
        }
        Update: {
          created_at?: string
          id?: number
          vapid_private_key?: string
          vapid_public_key?: string
        }
        Relationships: []
      }
      push_subscriptions: {
        Row: {
          auth: string
          created_at: string
          endpoint: string
          id: string
          p256dh: string
          user_id: string | null
        }
        Insert: {
          auth: string
          created_at?: string
          endpoint: string
          id?: string
          p256dh: string
          user_id?: string | null
        }
        Update: {
          auth?: string
          created_at?: string
          endpoint?: string
          id?: string
          p256dh?: string
          user_id?: string | null
        }
        Relationships: []
      }
      signals: {
        Row: {
          confidence_pct: number | null
          last_notified_at: string | null
          last_state_change_at: string | null
          miner_filter: string | null
          mpi: number | null
          netuid: number
          quality_score: number | null
          reasons: Json | null
          score: number | null
          state: string | null
          ts: string
        }
        Insert: {
          confidence_pct?: number | null
          last_notified_at?: string | null
          last_state_change_at?: string | null
          miner_filter?: string | null
          mpi?: number | null
          netuid: number
          quality_score?: number | null
          reasons?: Json | null
          score?: number | null
          state?: string | null
          ts: string
        }
        Update: {
          confidence_pct?: number | null
          last_notified_at?: string | null
          last_state_change_at?: string | null
          miner_filter?: string | null
          mpi?: number | null
          netuid?: number
          quality_score?: number | null
          reasons?: Json | null
          score?: number | null
          state?: string | null
          ts?: string
        }
        Relationships: [
          {
            foreignKeyName: "signals_netuid_fkey"
            columns: ["netuid"]
            isOneToOne: true
            referencedRelation: "subnets"
            referencedColumns: ["netuid"]
          },
        ]
      }
      subnet_metrics_ts: {
        Row: {
          cap: number | null
          daily_chain_buys_1m: number | null
          daily_chain_buys_3m: number | null
          daily_chain_buys_5m: number | null
          flow_15m: number | null
          flow_1m: number | null
          flow_3m: number | null
          flow_5m: number | null
          flow_6m: number | null
          id: number
          liquidity: number | null
          miners_active: number | null
          netuid: number
          price: number | null
          raw_payload: Json | null
          source: string | null
          top_miners_share: number | null
          ts: string
          vol_24h: number | null
          vol_cap: number | null
        }
        Insert: {
          cap?: number | null
          daily_chain_buys_1m?: number | null
          daily_chain_buys_3m?: number | null
          daily_chain_buys_5m?: number | null
          flow_15m?: number | null
          flow_1m?: number | null
          flow_3m?: number | null
          flow_5m?: number | null
          flow_6m?: number | null
          id?: number
          liquidity?: number | null
          miners_active?: number | null
          netuid: number
          price?: number | null
          raw_payload?: Json | null
          source?: string | null
          top_miners_share?: number | null
          ts: string
          vol_24h?: number | null
          vol_cap?: number | null
        }
        Update: {
          cap?: number | null
          daily_chain_buys_1m?: number | null
          daily_chain_buys_3m?: number | null
          daily_chain_buys_5m?: number | null
          flow_15m?: number | null
          flow_1m?: number | null
          flow_3m?: number | null
          flow_5m?: number | null
          flow_6m?: number | null
          id?: number
          liquidity?: number | null
          miners_active?: number | null
          netuid?: number
          price?: number | null
          raw_payload?: Json | null
          source?: string | null
          top_miners_share?: number | null
          ts?: string
          vol_24h?: number | null
          vol_cap?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "subnet_metrics_ts_netuid_fkey"
            columns: ["netuid"]
            isOneToOne: false
            referencedRelation: "subnets"
            referencedColumns: ["netuid"]
          },
        ]
      }
      subnet_price_daily: {
        Row: {
          date: string
          id: number
          netuid: number
          price_close: number | null
          price_high: number | null
          price_low: number | null
        }
        Insert: {
          date: string
          id?: never
          netuid: number
          price_close?: number | null
          price_high?: number | null
          price_low?: number | null
        }
        Update: {
          date?: string
          id?: never
          netuid?: number
          price_close?: number | null
          price_high?: number | null
          price_low?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "subnet_price_daily_netuid_fkey"
            columns: ["netuid"]
            isOneToOne: false
            referencedRelation: "subnets"
            referencedColumns: ["netuid"]
          },
        ]
      }
      subnets: {
        Row: {
          first_seen_at: string | null
          last_seen_at: string | null
          name: string | null
          netuid: number
        }
        Insert: {
          first_seen_at?: string | null
          last_seen_at?: string | null
          name?: string | null
          netuid: number
        }
        Update: {
          first_seen_at?: string | null
          last_seen_at?: string | null
          name?: string | null
          netuid?: number
        }
        Relationships: []
      }
      whale_coldkeys: {
        Row: {
          address: string
          created_at: string
          id: number
          label: string | null
        }
        Insert: {
          address: string
          created_at?: string
          id?: never
          label?: string | null
        }
        Update: {
          address?: string
          created_at?: string
          id?: never
          label?: string | null
        }
        Relationships: []
      }
      whale_movements: {
        Row: {
          amount_tao: number
          block_number: number | null
          coldkey_address: string
          counterparty: string | null
          detected_at: string
          direction: string
          id: number
          netuid: number | null
          raw_payload: Json | null
          tx_hash: string | null
        }
        Insert: {
          amount_tao: number
          block_number?: number | null
          coldkey_address: string
          counterparty?: string | null
          detected_at?: string
          direction: string
          id?: never
          netuid?: number | null
          raw_payload?: Json | null
          tx_hash?: string | null
        }
        Update: {
          amount_tao?: number
          block_number?: number | null
          coldkey_address?: string
          counterparty?: string | null
          detected_at?: string
          direction?: string
          id?: never
          netuid?: number | null
          raw_payload?: Json | null
          tx_hash?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "whale_movements_coldkey_address_fkey"
            columns: ["coldkey_address"]
            isOneToOne: false
            referencedRelation: "whale_coldkeys"
            referencedColumns: ["address"]
          },
        ]
      }
    }
    Views: {
      fx_latest: {
        Row: {
          tao_usd: number | null
          ts: string | null
        }
        Relationships: []
      }
      signals_latest: {
        Row: {
          confidence_pct: number | null
          last_notified_at: string | null
          last_state_change_at: string | null
          miner_filter: string | null
          mpi: number | null
          netuid: number | null
          quality_score: number | null
          reasons: Json | null
          score: number | null
          state: string | null
          subnet_name: string | null
          tao_usd: number | null
          ts: string | null
        }
        Relationships: [
          {
            foreignKeyName: "signals_netuid_fkey"
            columns: ["netuid"]
            isOneToOne: true
            referencedRelation: "subnets"
            referencedColumns: ["netuid"]
          },
        ]
      }
      subnet_latest: {
        Row: {
          cap: number | null
          daily_chain_buys_1m: number | null
          daily_chain_buys_3m: number | null
          daily_chain_buys_5m: number | null
          flow_1m: number | null
          flow_3m: number | null
          flow_5m: number | null
          id: number | null
          liquidity: number | null
          miners_active: number | null
          netuid: number | null
          price: number | null
          raw_payload: Json | null
          source: string | null
          top_miners_share: number | null
          ts: string | null
          vol_24h: number | null
          vol_cap: number | null
        }
        Relationships: [
          {
            foreignKeyName: "subnet_metrics_ts_netuid_fkey"
            columns: ["netuid"]
            isOneToOne: false
            referencedRelation: "subnets"
            referencedColumns: ["netuid"]
          },
        ]
      }
      subnet_latest_display: {
        Row: {
          cap: number | null
          cap_usd: number | null
          daily_chain_buys_1m: number | null
          daily_chain_buys_3m: number | null
          daily_chain_buys_5m: number | null
          flow_1m: number | null
          flow_3m: number | null
          flow_5m: number | null
          id: number | null
          liquidity: number | null
          liquidity_usd: number | null
          miners_active: number | null
          netuid: number | null
          price: number | null
          price_usd: number | null
          raw_payload: Json | null
          source: string | null
          tao_usd: number | null
          top_miners_share: number | null
          ts: string | null
          vol_24h: number | null
          vol_24h_usd: number | null
          vol_cap: number | null
        }
        Relationships: [
          {
            foreignKeyName: "subnet_metrics_ts_netuid_fkey"
            columns: ["netuid"]
            isOneToOne: false
            referencedRelation: "subnets"
            referencedColumns: ["netuid"]
          },
        ]
      }
    }
    Functions: {
      [_ in never]: never
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
