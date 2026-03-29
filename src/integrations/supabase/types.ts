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
      audit_log: {
        Row: {
          alignment_status: string | null
          data_confidence: number | null
          decision_reason: string | null
          engine_version: string
          event_type: string
          id: number
          inputs: Json
          kill_switch_active: boolean | null
          kill_switch_triggers: Json | null
          netuid: number | null
          outputs: Json
          snapshot_ids: Json
          subnet_count: number | null
          top_factors: Json
          ts: string
        }
        Insert: {
          alignment_status?: string | null
          data_confidence?: number | null
          decision_reason?: string | null
          engine_version?: string
          event_type: string
          id?: never
          inputs?: Json
          kill_switch_active?: boolean | null
          kill_switch_triggers?: Json | null
          netuid?: number | null
          outputs?: Json
          snapshot_ids?: Json
          subnet_count?: number | null
          top_factors?: Json
          ts?: string
        }
        Update: {
          alignment_status?: string | null
          data_confidence?: number | null
          decision_reason?: string | null
          engine_version?: string
          event_type?: string
          id?: never
          inputs?: Json
          kill_switch_active?: boolean | null
          kill_switch_triggers?: Json | null
          netuid?: number | null
          outputs?: Json
          snapshot_ids?: Json
          subnet_count?: number | null
          top_factors?: Json
          ts?: string
        }
        Relationships: []
      }
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
      external_delist_events: {
        Row: {
          created_at: string
          event_type: string
          id: string
          netuid: number
          new_value: string | null
          old_value: string | null
          source: string
        }
        Insert: {
          created_at?: string
          event_type: string
          id?: string
          netuid: number
          new_value?: string | null
          old_value?: string | null
          source?: string
        }
        Update: {
          created_at?: string
          event_type?: string
          id?: string
          netuid?: number
          new_value?: string | null
          old_value?: string | null
          source?: string
        }
        Relationships: []
      }
      external_delist_priority: {
        Row: {
          created_at: string
          delist_rank: number
          detected_at: string
          id: string
          is_active: boolean
          last_seen_at: string
          netuid: number
          notes: string | null
          source: string
          subnet_name: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          delist_rank: number
          detected_at?: string
          id?: string
          is_active?: boolean
          last_seen_at?: string
          netuid: number
          notes?: string | null
          source?: string
          subnet_name?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          delist_rank?: number
          detected_at?: string
          id?: string
          is_active?: boolean
          last_seen_at?: string
          netuid?: number
          notes?: string | null
          source?: string
          subnet_name?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      external_delist_watch: {
        Row: {
          created_at: string
          detected_at: string
          id: string
          is_active: boolean
          last_seen_at: string
          netuid: number
          notes: string | null
          source: string
          subnet_name: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          detected_at?: string
          id?: string
          is_active?: boolean
          last_seen_at?: string
          netuid: number
          notes?: string | null
          source?: string
          subnet_name?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          detected_at?: string
          id?: string
          is_active?: boolean
          last_seen_at?: string
          netuid?: number
          notes?: string | null
          source?: string
          subnet_name?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      external_taoflute_metrics: {
        Row: {
          created_at: string
          flags: Json | null
          id: string
          is_stale: boolean
          liq_haircut: number | null
          liq_price: number | null
          netuid: number
          raw_data: Json | null
          scraped_at: string
          source: string
        }
        Insert: {
          created_at?: string
          flags?: Json | null
          id?: string
          is_stale?: boolean
          liq_haircut?: number | null
          liq_price?: number | null
          netuid: number
          raw_data?: Json | null
          scraped_at?: string
          source?: string
        }
        Update: {
          created_at?: string
          flags?: Json | null
          id?: string
          is_stale?: boolean
          liq_haircut?: number | null
          liq_price?: number | null
          netuid?: number
          raw_data?: Json | null
          scraped_at?: string
          source?: string
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
      pipeline_snapshots: {
        Row: {
          engine_version: string
          id: number
          snapshot: Json
          subnet_count: number | null
          ts: string
        }
        Insert: {
          engine_version?: string
          id?: never
          snapshot?: Json
          subnet_count?: number | null
          ts?: string
        }
        Update: {
          engine_version?: string
          id?: never
          snapshot?: Json
          subnet_count?: number | null
          ts?: string
        }
        Relationships: []
      }
      portfolio_events: {
        Row: {
          action: string
          created_at: string
          id: string
          note: string | null
          price: number | null
          quantity_tao: number | null
          subnet_id: number
          user_id: string
        }
        Insert: {
          action: string
          created_at?: string
          id?: string
          note?: string | null
          price?: number | null
          quantity_tao?: number | null
          subnet_id: number
          user_id: string
        }
        Update: {
          action?: string
          created_at?: string
          id?: string
          note?: string | null
          price?: number | null
          quantity_tao?: number | null
          subnet_id?: number
          user_id?: string
        }
        Relationships: []
      }
      portfolio_positions: {
        Row: {
          created_at: string
          entry_price: number | null
          id: string
          note: string | null
          quantity_tao: number
          subnet_id: number
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          entry_price?: number | null
          id?: string
          note?: string | null
          quantity_tao?: number
          subnet_id: number
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          entry_price?: number | null
          id?: string
          note?: string | null
          quantity_tao?: number
          subnet_id?: number
          updated_at?: string
          user_id?: string
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
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          display_name: string | null
          id: string
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          display_name?: string | null
          id: string
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          display_name?: string | null
          id?: string
          updated_at?: string
        }
        Relationships: []
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
      push_log: {
        Row: {
          created_at: string
          endpoint: string
          error_message: string | null
          event_id: string
          event_type: string
          http_status: number | null
          id: number
          last_retry_at: string | null
          netuid: number | null
          payload: Json
          priority: number
          retry_count: number
          sent_at: string | null
          status: string
          subscription_id: string | null
        }
        Insert: {
          created_at?: string
          endpoint: string
          error_message?: string | null
          event_id: string
          event_type: string
          http_status?: number | null
          id?: never
          last_retry_at?: string | null
          netuid?: number | null
          payload?: Json
          priority?: number
          retry_count?: number
          sent_at?: string | null
          status?: string
          subscription_id?: string | null
        }
        Update: {
          created_at?: string
          endpoint?: string
          error_message?: string | null
          event_id?: string
          event_type?: string
          http_status?: number | null
          id?: never
          last_retry_at?: string | null
          netuid?: number | null
          payload?: Json
          priority?: number
          retry_count?: number
          sent_at?: string | null
          status?: string
          subscription_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "push_log_subscription_id_fkey"
            columns: ["subscription_id"]
            isOneToOne: false
            referencedRelation: "push_subscriptions"
            referencedColumns: ["id"]
          },
        ]
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
      social_accounts: {
        Row: {
          accuracy_history: number
          category: string
          created_at: string
          credibility_score: number
          display_name: string | null
          false_positive_rate: number
          handle: string
          id: string
          influence_weight: number
          is_active: boolean
          notes: string | null
          platform: string
          tier: string
          updated_at: string
        }
        Insert: {
          accuracy_history?: number
          category?: string
          created_at?: string
          credibility_score?: number
          display_name?: string | null
          false_positive_rate?: number
          handle: string
          id?: string
          influence_weight?: number
          is_active?: boolean
          notes?: string | null
          platform?: string
          tier?: string
          updated_at?: string
        }
        Update: {
          accuracy_history?: number
          category?: string
          created_at?: string
          credibility_score?: number
          display_name?: string | null
          false_positive_rate?: number
          handle?: string
          id?: string
          influence_weight?: number
          is_active?: boolean
          notes?: string | null
          platform?: string
          tier?: string
          updated_at?: string
        }
        Relationships: []
      }
      social_alerts: {
        Row: {
          alert_type: string
          created_at: string
          description: string | null
          id: string
          is_active: boolean
          severity: string
          source_count: number
          subnet_uid: number
          title: string
          weighted_score: number
        }
        Insert: {
          alert_type: string
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          severity?: string
          source_count?: number
          subnet_uid: number
          title: string
          weighted_score?: number
        }
        Update: {
          alert_type?: string
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          severity?: string
          source_count?: number
          subnet_uid?: number
          title?: string
          weighted_score?: number
        }
        Relationships: []
      }
      social_post_mentions: {
        Row: {
          confidence_extraction: number
          conviction_level: number
          created_at: string
          id: string
          mention_type: string
          post_id: string
          self_mention: boolean
          sentiment: string
          subnet_name: string | null
          subnet_uid: number
        }
        Insert: {
          confidence_extraction?: number
          conviction_level?: number
          created_at?: string
          id?: string
          mention_type?: string
          post_id: string
          self_mention?: boolean
          sentiment?: string
          subnet_name?: string | null
          subnet_uid: number
        }
        Update: {
          confidence_extraction?: number
          conviction_level?: number
          created_at?: string
          id?: string
          mention_type?: string
          post_id?: string
          self_mention?: boolean
          sentiment?: string
          subnet_name?: string | null
          subnet_uid?: number
        }
        Relationships: [
          {
            foreignKeyName: "social_post_mentions_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "social_posts"
            referencedColumns: ["id"]
          },
        ]
      }
      social_posts: {
        Row: {
          account_id: string
          clean_text: string | null
          created_at: string
          engagement_score: number
          external_post_id: string | null
          id: string
          language: string | null
          like_count: number
          post_type: string
          posted_at: string
          raw_text: string | null
          reply_count: number
          repost_count: number
          url: string | null
          view_count: number
        }
        Insert: {
          account_id: string
          clean_text?: string | null
          created_at?: string
          engagement_score?: number
          external_post_id?: string | null
          id?: string
          language?: string | null
          like_count?: number
          post_type?: string
          posted_at?: string
          raw_text?: string | null
          reply_count?: number
          repost_count?: number
          url?: string | null
          view_count?: number
        }
        Update: {
          account_id?: string
          clean_text?: string | null
          created_at?: string
          engagement_score?: number
          external_post_id?: string | null
          id?: string
          language?: string | null
          like_count?: number
          post_type?: string
          posted_at?: string
          raw_text?: string | null
          reply_count?: number
          repost_count?: number
          url?: string | null
          view_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "social_posts_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "social_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      social_subnet_scores: {
        Row: {
          created_at: string
          final_social_signal: string
          id: string
          narrative_strength: number
          pump_risk_score: number
          raw_mention_count: number
          score_date: string
          smart_kol_score: number
          social_conviction_score: number
          social_heat_score: number
          subnet_uid: number
          unique_account_count: number
          weighted_bearish_score: number
          weighted_bullish_score: number
        }
        Insert: {
          created_at?: string
          final_social_signal?: string
          id?: string
          narrative_strength?: number
          pump_risk_score?: number
          raw_mention_count?: number
          score_date?: string
          smart_kol_score?: number
          social_conviction_score?: number
          social_heat_score?: number
          subnet_uid: number
          unique_account_count?: number
          weighted_bearish_score?: number
          weighted_bullish_score?: number
        }
        Update: {
          created_at?: string
          final_social_signal?: string
          id?: string
          narrative_strength?: number
          pump_risk_score?: number
          raw_mention_count?: number
          score_date?: string
          smart_kol_score?: number
          social_conviction_score?: number
          social_heat_score?: number
          subnet_uid?: number
          unique_account_count?: number
          weighted_bearish_score?: number
          weighted_bullish_score?: number
        }
        Relationships: []
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
      subnet_stake_analytics: {
        Row: {
          holders_count: number | null
          id: number
          large_wallet_inflow: number | null
          large_wallet_outflow: number | null
          miners_active: number | null
          miners_total: number | null
          netuid: number
          raw_data: Json | null
          stake_concentration: number | null
          stake_total: number | null
          top10_stake: Json | null
          ts: string
          uid_usage: number | null
          validators_active: number | null
        }
        Insert: {
          holders_count?: number | null
          id?: never
          large_wallet_inflow?: number | null
          large_wallet_outflow?: number | null
          miners_active?: number | null
          miners_total?: number | null
          netuid: number
          raw_data?: Json | null
          stake_concentration?: number | null
          stake_total?: number | null
          top10_stake?: Json | null
          ts?: string
          uid_usage?: number | null
          validators_active?: number | null
        }
        Update: {
          holders_count?: number | null
          id?: never
          large_wallet_inflow?: number | null
          large_wallet_outflow?: number | null
          miners_active?: number | null
          miners_total?: number | null
          netuid?: number
          raw_data?: Json | null
          stake_concentration?: number | null
          stake_total?: number | null
          top10_stake?: Json | null
          ts?: string
          uid_usage?: number | null
          validators_active?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "subnet_stake_analytics_netuid_fkey"
            columns: ["netuid"]
            isOneToOne: false
            referencedRelation: "subnets"
            referencedColumns: ["netuid"]
          },
        ]
      }
      subnets: {
        Row: {
          canonical_name: string | null
          display_name: string | null
          first_seen_at: string | null
          last_seen_at: string | null
          name: string | null
          name_conflict_log: Json | null
          name_updated_at: string | null
          netuid: number
          source_name: string | null
        }
        Insert: {
          canonical_name?: string | null
          display_name?: string | null
          first_seen_at?: string | null
          last_seen_at?: string | null
          name?: string | null
          name_conflict_log?: Json | null
          name_updated_at?: string | null
          netuid: number
          source_name?: string | null
        }
        Update: {
          canonical_name?: string | null
          display_name?: string | null
          first_seen_at?: string | null
          last_seen_at?: string | null
          name?: string | null
          name_conflict_log?: Json | null
          name_updated_at?: string | null
          netuid?: number
          source_name?: string | null
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
