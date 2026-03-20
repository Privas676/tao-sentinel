/* ═══════════════════════════════════════ */
/*   CLOUD PORTFOLIO HOOK (Supabase)       */
/* ═══════════════════════════════════════ */
import { useState, useCallback, useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "./use-auth";

export type LocalPosition = {
  subnet_id: number;
  quantity_tao: number;
  entry_price?: number;
  note?: string;
  timestamp_added: string;
  updated_at?: string;
};

export type ArchivedPosition = LocalPosition & {
  closed_at: string;
  closed_price?: number;
  pnl_estimated?: number;
};

export type PortfolioEvent = {
  id: string;
  subnet_id: number;
  action: string;
  quantity_tao: number | null;
  price: number | null;
  note: string | null;
  created_at: string;
};

/* ── localStorage fallback keys (for unauthenticated / legacy) ── */
const STORAGE_KEY = "tao_sentinel_portfolio";
const ARCHIVE_KEY = "tao_sentinel_portfolio_archive";

function loadLocal(): LocalPosition[] {
  try { const raw = localStorage.getItem(STORAGE_KEY); return raw ? JSON.parse(raw) : []; }
  catch { return []; }
}
function saveLocal(positions: LocalPosition[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(positions));
}
function loadArchive(): ArchivedPosition[] {
  try { const raw = localStorage.getItem(ARCHIVE_KEY); return raw ? JSON.parse(raw) : []; }
  catch { return []; }
}
function saveArchive(archive: ArchivedPosition[]) {
  localStorage.setItem(ARCHIVE_KEY, JSON.stringify(archive));
}

/* ── Log event helper ── */
async function logEvent(userId: string, subnet_id: number, action: string, quantity_tao?: number, price?: number, note?: string) {
  await supabase.from("portfolio_events").insert({
    user_id: userId,
    subnet_id,
    action,
    quantity_tao: quantity_tao ?? null,
    price: price ?? null,
    note: note ?? null,
  } as any);
}

export function useLocalPortfolio() {
  const { user } = useAuth();
  const userId = user?.id;
  const [positions, setPositions] = useState<LocalPosition[]>([]);
  const [archive, setArchive] = useState<ArchivedPosition[]>(loadArchive);
  const [events, setEvents] = useState<PortfolioEvent[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const loadedRef = useRef(false);

  /* ── Load from Supabase on login ── */
  useEffect(() => {
    if (!userId) {
      setPositions(loadLocal());
      setIsLoading(false);
      loadedRef.current = false;
      return;
    }
    let cancelled = false;
    (async () => {
      setIsLoading(true);
      const { data } = await supabase
        .from("portfolio_positions")
        .select("*")
        .order("created_at", { ascending: true });
      if (cancelled) return;
      if (data && data.length > 0) {
        setPositions(data.map((r: any) => ({
          subnet_id: r.subnet_id,
          quantity_tao: Number(r.quantity_tao),
          entry_price: r.entry_price != null ? Number(r.entry_price) : undefined,
          note: r.note ?? undefined,
          timestamp_added: r.created_at,
          updated_at: r.updated_at,
        })));
      } else {
        // Migrate localStorage to cloud on first login
        const local = loadLocal();
        if (local.length > 0) {
          const rows = local.map(p => ({
            user_id: userId,
            subnet_id: p.subnet_id,
            quantity_tao: p.quantity_tao,
            entry_price: p.entry_price ?? null,
            note: (p as any).note ?? null,
          }));
          await supabase.from("portfolio_positions").upsert(rows as any, { onConflict: "user_id,subnet_id" });
          setPositions(local);
        } else {
          setPositions([]);
        }
      }
      // Load events
      const { data: evts } = await supabase
        .from("portfolio_events")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(200);
      if (!cancelled && evts) {
        setEvents(evts.map((e: any) => ({
          id: e.id,
          subnet_id: e.subnet_id,
          action: e.action,
          quantity_tao: e.quantity_tao != null ? Number(e.quantity_tao) : null,
          price: e.price != null ? Number(e.price) : null,
          note: e.note,
          created_at: e.created_at,
        })));
      }
      loadedRef.current = true;
      setIsLoading(false);
    })();
    return () => { cancelled = true; };
  }, [userId]);

  /* ── Sync localStorage fallback for unauthenticated ── */
  useEffect(() => {
    if (!userId) saveLocal(positions);
  }, [positions, userId]);
  useEffect(() => { saveArchive(archive); }, [archive]);

  /* ── Cloud persist helpers ── */
  const persistUpsert = useCallback(async (subnet_id: number, qty: number, entry_price?: number, note?: string) => {
    if (!userId) return;
    await supabase.from("portfolio_positions").upsert({
      user_id: userId,
      subnet_id,
      quantity_tao: qty,
      entry_price: entry_price ?? null,
      note: note ?? null,
    } as any, { onConflict: "user_id,subnet_id" });
  }, [userId]);

  const persistDelete = useCallback(async (subnet_id: number) => {
    if (!userId) return;
    await supabase.from("portfolio_positions").delete().eq("user_id", userId).eq("subnet_id", subnet_id);
  }, [userId]);

  /* ── Public API (same interface as before) ── */
  const addPosition = useCallback((subnet_id: number, quantity_tao: number, entry_price?: number) => {
    setPositions(prev => {
      const existing = prev.find(p => p.subnet_id === subnet_id);
      if (existing) {
        const newQty = existing.quantity_tao + quantity_tao;
        const newPrice = entry_price ?? existing.entry_price;
        persistUpsert(subnet_id, newQty, newPrice);
        if (userId) logEvent(userId, subnet_id, "REINFORCE", quantity_tao, entry_price);
        return prev.map(p =>
          p.subnet_id === subnet_id
            ? { ...p, quantity_tao: newQty, entry_price: newPrice }
            : p
        );
      }
      persistUpsert(subnet_id, quantity_tao, entry_price);
      if (userId) logEvent(userId, subnet_id, "ADD", quantity_tao, entry_price);
      return [...prev, { subnet_id, quantity_tao, entry_price, timestamp_added: new Date().toISOString() }];
    });
  }, [persistUpsert, userId]);

  const updateQuantity = useCallback((subnet_id: number, quantity_tao: number) => {
    setPositions(prev => {
      const pos = prev.find(p => p.subnet_id === subnet_id);
      if (pos) {
        persistUpsert(subnet_id, quantity_tao, pos.entry_price);
        if (userId) logEvent(userId, subnet_id, "UPDATE_QTY", quantity_tao);
      }
      return prev.map(p => p.subnet_id === subnet_id ? { ...p, quantity_tao } : p);
    });
  }, [persistUpsert, userId]);

  const removePosition = useCallback((subnet_id: number) => {
    setPositions(prev => {
      persistDelete(subnet_id);
      if (userId) logEvent(userId, subnet_id, "REMOVE");
      return prev.filter(p => p.subnet_id !== subnet_id);
    });
  }, [persistDelete, userId]);

  const sellPosition = useCallback((subnet_id: number, closedPrice?: number) => {
    setPositions(prev => {
      const pos = prev.find(p => p.subnet_id === subnet_id);
      if (!pos) return prev;
      const pnl = closedPrice && pos.entry_price
        ? (closedPrice - pos.entry_price) * pos.quantity_tao
        : undefined;
      setArchive(a => [...a, {
        ...pos,
        closed_at: new Date().toISOString(),
        closed_price: closedPrice,
        pnl_estimated: pnl,
      }]);
      persistDelete(subnet_id);
      if (userId) logEvent(userId, subnet_id, "SELL", pos.quantity_tao, closedPrice);
      return prev.filter(p => p.subnet_id !== subnet_id);
    });
  }, [persistDelete, userId]);

  const ownedNetuids = new Set(positions.map(p => p.subnet_id));
  const isOwned = useCallback((netuid: number) => ownedNetuids.has(netuid), [ownedNetuids]);

  return {
    positions,
    archive,
    events,
    ownedNetuids,
    isOwned,
    isLoading,
    addPosition,
    updateQuantity,
    removePosition,
    sellPosition,
  };
}
