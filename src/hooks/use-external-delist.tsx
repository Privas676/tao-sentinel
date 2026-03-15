/* ═══════════════════════════════════════ */
/*   EXTERNAL DELIST DATA HOOK              */
/*   Fetches Taoflute delist lists from DB  */
/*   Provides real-time external risk data  */
/*   Uses STRICT subnet_id matching via     */
/*   TaoFlute resolver.                     */
/* ═══════════════════════════════════════ */

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  resolveAllTaoFluteStatuses,
  taoFluteColumnLabel,
  type TaoFluteResolvedStatus,
} from "@/lib/taoflute-resolver";

export type ExternalDelistPriority = {
  netuid: number;
  subnet_name: string | null;
  delist_rank: number;
  source: string;
  detected_at: string;
  last_seen_at: string;
  is_active: boolean;
};

export type ExternalDelistWatch = {
  netuid: number;
  subnet_name: string | null;
  source: string;
  detected_at: string;
  last_seen_at: string;
  is_active: boolean;
};

export type ExternalTaofluteMetrics = {
  netuid: number;
  liq_price: number | null;
  liq_haircut: number | null;
  flags: string[];
  is_stale: boolean;
  scraped_at: string;
  source: string;
};

/** @deprecated Use TaoFluteResolvedStatus instead */
export type ExternalDelistStatus = "critical" | "high" | "none";

/** @deprecated Use TaoFluteResolvedStatus instead */
export type ExternalDelistInfo = {
  status: ExternalDelistStatus;
  rank: number | null;
  source: string;
  list: "priority" | "watch" | null;
  lastSeen: string;
};

export type UseExternalDelistResult = {
  priorityList: ExternalDelistPriority[];
  watchList: ExternalDelistWatch[];
  taoflute: Map<number, ExternalTaofluteMetrics>;
  /** @deprecated Use taoFluteStatuses instead */
  delistInfo: Map<number, ExternalDelistInfo>;
  /** Set of netuids in priority list */
  priorityNetuids: Set<number>;
  /** Set of netuids in watch list */
  watchNetuids: Set<number>;
  /** NEW: Strict TaoFlute resolved statuses (by subnet_id only) */
  taoFluteStatuses: Map<number, TaoFluteResolvedStatus>;
  isLoading: boolean;
};

export function useExternalDelist(): UseExternalDelistResult {
  const { data: priorityList = [], isLoading: pLoading } = useQuery({
    queryKey: ["external-delist-priority"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("external_delist_priority")
        .select("*")
        .eq("is_active", true)
        .order("delist_rank", { ascending: true });
      if (error) throw error;
      return (data || []) as ExternalDelistPriority[];
    },
    refetchInterval: 120_000,
  });

  const { data: watchList = [], isLoading: wLoading } = useQuery({
    queryKey: ["external-delist-watch"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("external_delist_watch")
        .select("*")
        .eq("is_active", true);
      if (error) throw error;
      return (data || []) as ExternalDelistWatch[];
    },
    refetchInterval: 120_000,
  });

  const { data: taofluteRaw = [], isLoading: tLoading } = useQuery({
    queryKey: ["external-taoflute-metrics"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("external_taoflute_metrics")
        .select("*");
      if (error) throw error;
      return (data || []) as any[];
    },
    refetchInterval: 120_000,
  });

  const taoflute = useMemo(() => {
    const map = new Map<number, ExternalTaofluteMetrics>();
    for (const r of taofluteRaw) {
      map.set(r.netuid, {
        netuid: r.netuid,
        liq_price: r.liq_price != null ? Number(r.liq_price) : null,
        liq_haircut: r.liq_haircut != null ? Number(r.liq_haircut) : null,
        flags: Array.isArray(r.flags) ? r.flags : [],
        is_stale: r.is_stale,
        scraped_at: r.scraped_at,
        source: r.source,
      });
    }
    return map;
  }, [taofluteRaw]);

  const priorityNetuids = useMemo(() => new Set(priorityList.map(p => p.netuid)), [priorityList]);
  const watchNetuids = useMemo(() => new Set(watchList.map(w => w.netuid)), [watchList]);

  // Build DB lookup maps for the resolver
  const { dbPriority, dbWatch, dbMetrics } = useMemo(() => {
    const dbP = new Map<number, { rank: number; source: string; lastSeen: string }>();
    for (const p of priorityList) {
      dbP.set(p.netuid, { rank: p.delist_rank, source: p.source, lastSeen: p.last_seen_at });
    }
    const dbW = new Map<number, { source: string; lastSeen: string }>();
    for (const w of watchList) {
      if (!dbP.has(w.netuid)) { // Priority takes precedence
        dbW.set(w.netuid, { source: w.source, lastSeen: w.last_seen_at });
      }
    }
    const dbM = new Map<number, { liq_haircut: number | null; liq_price: number | null; is_stale: boolean; scraped_at: string }>();
    for (const [netuid, m] of taoflute) {
      dbM.set(netuid, { liq_haircut: m.liq_haircut, liq_price: m.liq_price, is_stale: m.is_stale, scraped_at: m.scraped_at });
    }
    return { dbPriority: dbP, dbWatch: dbW, dbMetrics: dbM };
  }, [priorityList, watchList, taoflute]);

  // Resolve all known subnet IDs
  const taoFluteStatuses = useMemo(() => {
    const allIds = new Set<number>();
    for (const p of priorityList) allIds.add(p.netuid);
    for (const w of watchList) allIds.add(w.netuid);
    for (const [id] of taoflute) allIds.add(id);
    return resolveAllTaoFluteStatuses(Array.from(allIds), dbPriority, dbWatch, dbMetrics);
  }, [priorityList, watchList, taoflute, dbPriority, dbWatch, dbMetrics]);

  // Legacy delistInfo (deprecated, kept for backward compat)
  const delistInfo = useMemo(() => {
    const map = new Map<number, ExternalDelistInfo>();
    for (const p of priorityList) {
      map.set(p.netuid, {
        status: "critical",
        rank: p.delist_rank,
        source: p.source,
        list: "priority",
        lastSeen: p.last_seen_at,
      });
    }
    for (const w of watchList) {
      if (!map.has(w.netuid)) {
        map.set(w.netuid, {
          status: "high",
          rank: null,
          source: w.source,
          list: "watch",
          lastSeen: w.last_seen_at,
        });
      }
    }
    return map;
  }, [priorityList, watchList]);

  return {
    priorityList,
    watchList,
    taoflute,
    delistInfo,
    priorityNetuids,
    watchNetuids,
    taoFluteStatuses,
    isLoading: pLoading || wLoading || tLoading,
  };
}
