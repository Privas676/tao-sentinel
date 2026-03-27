/* ═══════════════════════════════════════ */
/*   CLOUD PORTFOLIO HOOK (Supabase)       */
/* ═══════════════════════════════════════ */
import { useState, useCallback, useEffect, useMemo } from "react";
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

const STORAGE_KEY = "tao_sentinel_portfolio";
const ARCHIVE_KEY = "tao_sentinel_portfolio_archive";

function loadLocal(): LocalPosition[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveLocal(positions: LocalPosition[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(positions));
}

function loadArchive(): ArchivedPosition[] {
  try {
    const raw = localStorage.getItem(ARCHIVE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveArchive(archive: ArchivedPosition[]) {
  localStorage.setItem(ARCHIVE_KEY, JSON.stringify(archive));
}

function mapPositionRow(row: any): LocalPosition {
  return {
    subnet_id: row.subnet_id,
    quantity_tao: Number(row.quantity_tao),
    entry_price: row.entry_price != null ? Number(row.entry_price) : undefined,
    note: row.note ?? undefined,
    timestamp_added: row.created_at,
    updated_at: row.updated_at,
  };
}

function mapEventRow(row: any): PortfolioEvent {
  return {
    id: row.id,
    subnet_id: row.subnet_id,
    action: row.action,
    quantity_tao: row.quantity_tao != null ? Number(row.quantity_tao) : null,
    price: row.price != null ? Number(row.price) : null,
    note: row.note,
    created_at: row.created_at,
  };
}

async function loadCloudPositions() {
  const { data, error } = await supabase
    .from("portfolio_positions")
    .select("*")
    .order("created_at", { ascending: true });

  if (error) throw error;
  return data ?? [];
}

async function loadCloudEvents() {
  const { data, error } = await supabase
    .from("portfolio_events")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(200);

  if (error) throw error;
  return data ?? [];
}

async function logEvent(
  userId: string,
  subnet_id: number,
  action: string,
  quantity_tao?: number,
  price?: number,
  note?: string,
) {
  const { data, error } = await supabase
    .from("portfolio_events")
    .insert({
      user_id: userId,
      subnet_id,
      action,
      quantity_tao: quantity_tao ?? null,
      price: price ?? null,
      note: note ?? null,
    } as any)
    .select("*")
    .single();

  if (error) throw error;
  return mapEventRow(data);
}

export function useLocalPortfolio() {
  const { user } = useAuth();
  const userId = user?.id;
  const [positions, setPositions] = useState<LocalPosition[]>([]);
  const [archive, setArchive] = useState<ArchivedPosition[]>(loadArchive);
  const [events, setEvents] = useState<PortfolioEvent[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    const loadPortfolio = async () => {
      if (!userId) {
        setPositions(loadLocal());
        setEvents([]);
        setIsLoading(false);
        return;
      }

      setIsLoading(true);

      try {
        const [cloudPositions, cloudEvents] = await Promise.all([
          loadCloudPositions(),
          loadCloudEvents(),
        ]);

        if (cancelled) return;

        if (cloudPositions.length > 0) {
          setPositions(cloudPositions.map(mapPositionRow));
        } else {
          const local = loadLocal();

          if (local.length > 0) {
            const rows = local.map((p) => ({
              user_id: userId,
              subnet_id: p.subnet_id,
              quantity_tao: p.quantity_tao,
              entry_price: p.entry_price ?? null,
              note: p.note ?? null,
            }));

            const { error } = await supabase
              .from("portfolio_positions")
              .upsert(rows as any, { onConflict: "user_id,subnet_id" });

            if (error) throw error;
            if (cancelled) return;
            setPositions(local);
          } else {
            setPositions([]);
          }
        }

        setEvents(cloudEvents.map(mapEventRow));
      } catch (error) {
        console.error("[portfolio] Failed to load cloud portfolio", error);
        if (cancelled) return;
        setPositions(loadLocal());
        setEvents([]);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };

    void loadPortfolio();

    return () => {
      cancelled = true;
    };
  }, [userId]);

  useEffect(() => {
    if (!userId) saveLocal(positions);
  }, [positions, userId]);

  useEffect(() => {
    saveArchive(archive);
  }, [archive]);

  const persistUpsert = useCallback(
    async (subnet_id: number, qty: number, entry_price?: number, note?: string) => {
      if (!userId) return;

      const { error } = await supabase.from("portfolio_positions").upsert(
        {
          user_id: userId,
          subnet_id,
          quantity_tao: qty,
          entry_price: entry_price ?? null,
          note: note ?? null,
        } as any,
        { onConflict: "user_id,subnet_id" },
      );

      if (error) throw error;
    },
    [userId],
  );

  const persistDelete = useCallback(
    async (subnet_id: number) => {
      if (!userId) return;

      const { error } = await supabase
        .from("portfolio_positions")
        .delete()
        .eq("user_id", userId)
        .eq("subnet_id", subnet_id);

      if (error) throw error;
    },
    [userId],
  );

  const appendEvent = useCallback((event: PortfolioEvent) => {
    setEvents((prev) => [event, ...prev].slice(0, 200));
  }, []);

  const addPosition = useCallback(
    async (subnet_id: number, quantity_tao: number, entry_price?: number) => {
      let nextPosition: LocalPosition | null = null;
      let action = "ADD";
      let eventQty = quantity_tao;
      let eventPrice = entry_price;

      setPositions((prev) => {
        const existing = prev.find((p) => p.subnet_id === subnet_id);

        if (existing) {
          const newQty = existing.quantity_tao + quantity_tao;
          const newPrice = entry_price ?? existing.entry_price;
          action = "REINFORCE";
          eventPrice = entry_price;
          nextPosition = {
            ...existing,
            quantity_tao: newQty,
            entry_price: newPrice,
          };

          return prev.map((p) => (p.subnet_id === subnet_id ? nextPosition! : p));
        }

        nextPosition = {
          subnet_id,
          quantity_tao,
          entry_price,
          timestamp_added: new Date().toISOString(),
        };

        return [...prev, nextPosition];
      });

      if (!userId || !nextPosition) return;

      try {
        const event = await logEvent(userId, subnet_id, action, eventQty, eventPrice);
        await persistUpsert(
          subnet_id,
          nextPosition.quantity_tao,
          nextPosition.entry_price,
          nextPosition.note,
        );
        appendEvent(event);
      } catch (error) {
        console.error("[portfolio] Failed to persist add/reinforce", error);
      }
    },
    [appendEvent, persistUpsert, userId],
  );

  const updateQuantity = useCallback(
    async (subnet_id: number, quantity_tao: number) => {
      let nextPosition: LocalPosition | null = null;

      setPositions((prev) =>
        prev.map((p) => {
          if (p.subnet_id !== subnet_id) return p;

          nextPosition = {
            ...p,
            quantity_tao,
          };

          return nextPosition;
        }),
      );

      if (!userId || !nextPosition) return;

      try {
        const event = await logEvent(userId, subnet_id, "UPDATE_QTY", quantity_tao);
        await persistUpsert(
          subnet_id,
          nextPosition.quantity_tao,
          nextPosition.entry_price,
          nextPosition.note,
        );
        appendEvent(event);
      } catch (error) {
        console.error("[portfolio] Failed to persist quantity update", error);
      }
    },
    [appendEvent, persistUpsert, userId],
  );

  const removePosition = useCallback(
    async (subnet_id: number) => {
      console.log("[portfolio] removePosition called", { subnet_id, userId });

      // Read current state synchronously via ref-like pattern
      const currentPositions = await new Promise<LocalPosition[]>((resolve) => {
        setPositions((prev) => {
          resolve(prev);
          return prev; // don't mutate yet
        });
      });

      const pos = currentPositions.find((p) => p.subnet_id === subnet_id);
      if (!pos) {
        console.warn("[portfolio] removePosition: subnet not found", subnet_id, currentPositions.map(p => p.subnet_id));
        return;
      }

      // Optimistic removal
      const snapshot = currentPositions;
      setPositions((prev) => prev.filter((p) => p.subnet_id !== subnet_id));
      console.log("[portfolio] removePosition: optimistic removal of", subnet_id);

      if (!userId) {
        console.log("[portfolio] removePosition local-only (no userId)", subnet_id);
        return;
      }

      try {
        console.log("[portfolio] removePosition: persisting DELETE to cloud...", subnet_id);
        const [event] = await Promise.all([
          logEvent(userId, subnet_id, "REMOVE"),
          persistDelete(subnet_id),
        ]);
        console.log("[portfolio] DELETE persisted for subnet", subnet_id);
        appendEvent(event);
      } catch (error) {
        console.error("[portfolio] Failed to persist removal, rolling back", error);
        setPositions(snapshot);
      }
    },
    [appendEvent, persistDelete, userId],
  );

  const sellPosition = useCallback(
    async (subnet_id: number, closedPrice?: number) => {
      const snapshot = positions;
      const archiveSnapshot = archive;
      const pos = snapshot.find((p) => p.subnet_id === subnet_id);
      if (!pos) return;

      const pnl = closedPrice && pos.entry_price
        ? (closedPrice - pos.entry_price) * pos.quantity_tao
        : undefined;

      const archivedPosition: ArchivedPosition = {
        ...pos,
        closed_at: new Date().toISOString(),
        closed_price: closedPrice,
        pnl_estimated: pnl,
      };

      // Optimistic update
      setPositions((prev) => prev.filter((p) => p.subnet_id !== subnet_id));
      setArchive((prev) => [...prev, archivedPosition]);

      if (!userId) return;

      try {
        const event = await logEvent(userId, subnet_id, "SELL", pos.quantity_tao, closedPrice);
        await persistDelete(subnet_id);
        appendEvent(event);
      } catch (error) {
        console.error("[portfolio] Failed to persist sell, rolling back", error);
        setPositions(snapshot);
        setArchive(archiveSnapshot);
      }
    },
    [appendEvent, archive, persistDelete, positions, userId],
  );

  const ownedNetuids = useMemo(() => new Set(positions.map((p) => p.subnet_id)), [positions]);
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
