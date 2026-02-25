

# TAO Sentinel — Full Implementation Plan

## Overview
A real-time analytics and alpha detection system for all Bittensor subnets. The system ingests data every minute, computes GO/HOLD/EXIT signals, and displays them in a dark, Grafana-inspired dashboard. USD is the default currency with a TAO toggle.

---

## Phase 1: Supabase Setup & Database

### Connect Supabase
- Connect the project to Supabase via project settings.

### Database Schema
- Create tables: `subnets`, `subnet_metrics_ts`, `signals`, `events`, `fx_rates` with all specified columns, constraints, and indexes.

### Views
- `subnet_latest` — latest metric row per subnet
- `fx_latest` — latest FX rate
- `subnet_latest_display` — joins subnet_latest with fx_latest for USD conversions
- `signals_latest` — latest signals with subnet name and display currency fields

---

## Phase 2: Edge Functions (Backend)

### Secret: TAOSTATS_API_KEY
- Securely stored in Supabase secrets.

### Edge Function 1: `sync-subnets-minutely`
- Fetches all subnets from Taostats API
- Upserts into `subnets` table (name defaults to "SN-{netuid}" if missing)
- Detects new subnets and inserts CREATED events

### Edge Function 2: `sync-metrics-minutely`
- Fetches subnet data from Taostats
- Inserts one snapshot per subnet into `subnet_metrics_ts`
- Computes flow and buys short-window deltas from previous snapshots
- Stores raw payload for traceability

### Edge Function 3: `sync-fx-rate-minutely`
- Fetches TAO/USD price (Taostats or fallback)
- Inserts into `fx_rates`

### Edge Function 4: `compute-signals-minutely`
- Core signal engine with five sub-engines:
  - **Miner Filter**: PASS/WARN/FAIL based on miner activity and concentration
  - **GO Engine**: Detects flow + buys acceleration with price compression → GO or GO_SPECULATIVE (12-min cooldown)
  - **HOLD Engine**: Confirms winners running (price up, flow sustained) → HOLD (60-min dedup)
  - **EXIT_FAST Engine**: Rapid exit on flow/buys collapse, liquidity drop, or score crash (15-min dedup)
  - **DEPEG Detection**: WARNING/CRITICAL badges (no notifications yet)
- Computes score (0–100) and top 3 reasons
- Upserts `signals` table, inserts `events`

### Cron Schedule (pg_cron)
- All four functions scheduled every 1 minute via `pg_cron` + `pg_net`

---

## Phase 3: Frontend — Dark Grafana-Style UI

### Global Elements
- Dark professional theme (Grafana-inspired color palette)
- Currency toggle (USD default / TAO) persisted in localStorage
- Stale data indicator (if metrics > 2 minutes old)
- All timestamps displayed in Europe/Zurich timezone
- Real-time data via Supabase subscriptions or 1-minute polling

### Page 1: GO Radar (Landing Page)
- Four sections: GO NOW, GO SPECULATIVE, HOLD, WATCH
- Each row shows: NetUID, Name, Score, 3 Reasons, MinerFilter badge, timestamp
- Filter toggles: "Only PASS", "Hide WATCH"
- Color-coded cards/rows matching signal state

### Page 2: Subnets Overview
- Full data table with columns: NetUID, Price, Cap, Vol(24h), Vol/Cap, Liquidity, Flow, MinerFilter, Signal badge
- Signal column with colored badges (green GO, amber SPEC, blue HOLD, red EXIT, gray WATCH, dim NO)
- Signal age text ("2m ago")
- Quick filter bar: [GO] [SPEC] [HOLD] [EXIT] [WATCH] [ALL]
- Default sort: EXIT_FAST → GO → GO_SPEC → HOLD → WATCH → NO
- Row highlights: EXIT_FAST background, GO/SPEC left accent bar, HOLD accent style
- Row click navigates to subnet detail page
- Search functionality
- Server-side pagination

### Page 3: Subnet Detail
- Time-range selector (6h / 24h)
- Charts: Price, Liquidity, Flow, Buys over time (using Recharts)
- Event timeline (GO/HOLD/EXIT/CREATED/DEPEG entries)
- Drivers panel showing reasons and evidence

### Page 4: Alerts
- Chronological events list (GO/HOLD/EXIT)
- Expandable evidence drawer per event
- Filter by event type and subnet

### Navigation
- Sidebar or top nav: GO Radar, Subnets, Alerts
- Active page indicator

---

## Data Flow Summary
```
Taostats API → Edge Functions (every 1 min) → Supabase DB → Views → Frontend
```
- Frontend reads from views (`subnet_latest_display`, `signals_latest`) and tables (`events`, `subnet_metrics_ts`)
- Frontend never calls external APIs directly
- Events table ready for future Telegram/notification integration

