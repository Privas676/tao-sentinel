/* ═══════════════════════════════════════ */
/*   LOCAL PORTFOLIO HOOK (localStorage)    */
/* ═══════════════════════════════════════ */
import { useState, useCallback, useEffect } from "react";

export type LocalPosition = {
  subnet_id: number;
  quantity_tao: number;
  entry_price?: number;
  timestamp_added: string;
};

export type ArchivedPosition = LocalPosition & {
  closed_at: string;
  closed_price?: number;
  pnl_estimated?: number;
};

const STORAGE_KEY = "tao_sentinel_portfolio";
const ARCHIVE_KEY = "tao_sentinel_portfolio_archive";

function loadPositions(): LocalPosition[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

function savePositions(positions: LocalPosition[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(positions));
}

function loadArchive(): ArchivedPosition[] {
  try {
    const raw = localStorage.getItem(ARCHIVE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

function saveArchive(archive: ArchivedPosition[]) {
  localStorage.setItem(ARCHIVE_KEY, JSON.stringify(archive));
}

export function useLocalPortfolio() {
  const [positions, setPositions] = useState<LocalPosition[]>(loadPositions);
  const [archive, setArchive] = useState<ArchivedPosition[]>(loadArchive);

  // Sync to localStorage
  useEffect(() => { savePositions(positions); }, [positions]);
  useEffect(() => { saveArchive(archive); }, [archive]);

  const addPosition = useCallback((subnet_id: number, quantity_tao: number, entry_price?: number) => {
    setPositions(prev => {
      const existing = prev.find(p => p.subnet_id === subnet_id);
      if (existing) {
        // Update quantity instead of duplicate
        return prev.map(p =>
          p.subnet_id === subnet_id
            ? { ...p, quantity_tao: p.quantity_tao + quantity_tao, entry_price: entry_price ?? p.entry_price }
            : p
        );
      }
      return [...prev, { subnet_id, quantity_tao, entry_price, timestamp_added: new Date().toISOString() }];
    });
  }, []);

  const updateQuantity = useCallback((subnet_id: number, quantity_tao: number) => {
    setPositions(prev =>
      prev.map(p => p.subnet_id === subnet_id ? { ...p, quantity_tao } : p)
    );
  }, []);

  const removePosition = useCallback((subnet_id: number) => {
    setPositions(prev => prev.filter(p => p.subnet_id !== subnet_id));
  }, []);

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
      return prev.filter(p => p.subnet_id !== subnet_id);
    });
  }, []);

  const ownedNetuids = new Set(positions.map(p => p.subnet_id));
  const isOwned = useCallback((netuid: number) => ownedNetuids.has(netuid), [ownedNetuids]);

  return {
    positions,
    archive,
    ownedNetuids,
    isOwned,
    addPosition,
    updateQuantity,
    removePosition,
    sellPosition,
  };
}
