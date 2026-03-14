/* ═══════════════════════════════════════ */
/*   EXTERNAL DELIST DATA HOOK              */
/*   Fetches Taoflute delist lists from DB  */
/*   Provides real-time external risk data  */
/* ═══════════════════════════════════════ */

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

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

export type ExternalDelistStatus = "critical" | "high" | "none";

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
  /** Quick lookup: netuid → delist info */
  delistInfo: Map<number, ExternalDelistInfo>;
  /** Set of netuids in priority list */
  priorityNetuids: Set<number>;
  /** Set of netuids in watch list */
  watchNetuids: Set<number>;
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

  const taoflute = new Map<number, ExternalTaofluteMetrics>();
  for (const r of taofluteRaw) {
    taoflute.set(r.netuid, {
      netuid: r.netuid,
      liq_price: r.liq_price != null ? Number(r.liq_price) : null,
      liq_haircut: r.liq_haircut != null ? Number(r.liq_haircut) : null,
      flags: Array.isArray(r.flags) ? r.flags : [],
      is_stale: r.is_stale,
      scraped_at: r.scraped_at,
      source: r.source,
    });
  }

  const priorityNetuids = new Set(priorityList.map(p => p.netuid));
  const watchNetuids = new Set(watchList.map(w => w.netuid));

  const delistInfo = new Map<number, ExternalDelistInfo>();
  for (const p of priorityList) {
    delistInfo.set(p.netuid, {
      status: "critical",
      rank: p.delist_rank,
      source: p.source,
      list: "priority",
      lastSeen: p.last_seen_at,
    });
  }
  for (const w of watchList) {
    if (!delistInfo.has(w.netuid)) {
      delistInfo.set(w.netuid, {
        status: "high",
        rank: null,
        source: w.source,
        list: "watch",
        lastSeen: w.last_seen_at,
      });
    }
  }

  return {
    priorityList,
    watchList,
    taoflute,
    delistInfo,
    priorityNetuids,
    watchNetuids,
    isLoading: pLoading || wLoading || tLoading,
  };
}
