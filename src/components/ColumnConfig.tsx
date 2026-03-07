/* ═══════════════════════════════════════ */
/*   COLUMN CONFIGURATION COMPONENT         */
/*   Presets (Compact/Standard/Pro) + toggle */
/* ═══════════════════════════════════════ */

import { useState, useCallback, useMemo } from "react";

export type ColumnKey =
  | "netuid" | "name" | "verdict" | "dstate" | "status"
  | "price" | "var30d" | "spark" | "opp" | "risk"
  | "depeg" | "asymmetry" | "action" | "momentum"
  | "sc" | "confiance" | "health" | "tmc" | "owned";

export type ColumnDef = {
  key: ColumnKey;
  label: string;
  required?: boolean; // always shown
};

export const ALL_COLUMNS: ColumnDef[] = [
  { key: "netuid", label: "SN", required: true },
  { key: "name", label: "Nom", required: true },
  { key: "verdict", label: "Verdict" },
  { key: "dstate", label: "État" },
  { key: "status", label: "Statut" },
  { key: "price", label: "Prix α" },
  { key: "var30d", label: "Var 30j" },
  { key: "spark", label: "Prix 7j" },
  { key: "opp", label: "Opportunité" },
  { key: "risk", label: "Risque" },
  { key: "depeg", label: "Depeg %" },
  { key: "asymmetry", label: "AS" },
  { key: "action", label: "Action" },
  { key: "momentum", label: "Momentum" },
  { key: "sc", label: "Smart Capital" },
  { key: "confiance", label: "Confiance" },
  { key: "health", label: "🔬" },
  { key: "tmc", label: "📊" },
  { key: "owned", label: "✔" },
];

export type ColumnPreset = "compact" | "standard" | "pro";

const COMPACT_COLS: ColumnKey[] = ["netuid", "name", "verdict", "opp", "risk", "action", "momentum", "owned"];
const STANDARD_COLS: ColumnKey[] = ["netuid", "name", "verdict", "dstate", "status", "price", "spark", "opp", "risk", "asymmetry", "action", "momentum"];
const PRO_COLS: ColumnKey[] = ALL_COLUMNS.map(c => c.key);

export function getPresetColumns(preset: ColumnPreset): Set<ColumnKey> {
  switch (preset) {
    case "compact": return new Set(COMPACT_COLS);
    case "standard": return new Set(STANDARD_COLS);
    case "pro": return new Set(PRO_COLS);
  }
}

const STORAGE_KEY = "subnet-columns-v1";
const PRESET_KEY = "subnet-preset-v1";

function loadSaved(): { preset: ColumnPreset; columns: Set<ColumnKey> } {
  try {
    const preset = (localStorage.getItem(PRESET_KEY) || "standard") as ColumnPreset;
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      const cols = JSON.parse(saved) as ColumnKey[];
      return { preset: "standard", columns: new Set(cols) };
    }
    return { preset, columns: getPresetColumns(preset) };
  } catch {
    return { preset: "standard", columns: getPresetColumns("standard") };
  }
}

export function useColumnConfig() {
  const [state, setState] = useState(loadSaved);

  const setPreset = useCallback((preset: ColumnPreset) => {
    const columns = getPresetColumns(preset);
    setState({ preset, columns });
    localStorage.setItem(PRESET_KEY, preset);
    localStorage.removeItem(STORAGE_KEY);
  }, []);

  const toggleColumn = useCallback((key: ColumnKey) => {
    setState(prev => {
      const col = ALL_COLUMNS.find(c => c.key === key);
      if (col?.required) return prev;
      const next = new Set(prev.columns);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      localStorage.setItem(STORAGE_KEY, JSON.stringify([...next]));
      localStorage.removeItem(PRESET_KEY);
      return { preset: prev.preset, columns: next };
    });
  }, []);

  const isVisible = useCallback((key: ColumnKey) => state.columns.has(key), [state.columns]);

  return { preset: state.preset, visibleColumns: state.columns, setPreset, toggleColumn, isVisible };
}

/* ── UI Component ── */

export function ColumnConfigPanel({ preset, visibleColumns, setPreset, toggleColumn }: {
  preset: ColumnPreset;
  visibleColumns: Set<ColumnKey>;
  setPreset: (p: ColumnPreset) => void;
  toggleColumn: (k: ColumnKey) => void;
}) {
  const [open, setOpen] = useState(false);

  const presets: { value: ColumnPreset; label: string; count: number }[] = [
    { value: "compact", label: "Compact", count: COMPACT_COLS.length },
    { value: "standard", label: "Standard", count: STANDARD_COLS.length },
    { value: "pro", label: "Pro", count: PRO_COLS.length },
  ];

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="font-mono text-[10px] tracking-wider px-3 py-1.5 rounded-lg transition-all hover:bg-white/[0.05]"
        style={{
          background: "rgba(255,255,255,0.02)",
          border: "1px solid rgba(255,255,255,0.08)",
          color: "rgba(255,255,255,0.45)",
        }}
      >
        ⚙ Colonnes ({visibleColumns.size})
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div
            className="absolute right-0 top-full mt-2 z-50 rounded-xl font-mono text-[10px] w-[260px]"
            style={{
              background: "rgba(10,10,14,0.98)",
              border: "1px solid rgba(255,215,120,0.15)",
              boxShadow: "0 8px 40px rgba(0,0,0,0.8), 0 0 20px rgba(255,215,120,0.05)",
            }}
          >
            {/* Presets */}
            <div className="px-3 py-2.5 border-b" style={{ borderColor: "rgba(255,255,255,0.06)" }}>
              <div className="text-[8px] tracking-widest mb-2" style={{ color: "rgba(255,215,0,0.4)" }}>PRESETS</div>
              <div className="flex gap-1.5">
                {presets.map(p => (
                  <button
                    key={p.value}
                    onClick={() => setPreset(p.value)}
                    className="flex-1 py-1.5 rounded-lg transition-all text-center"
                    style={{
                      background: preset === p.value ? "rgba(255,215,0,0.1)" : "rgba(255,255,255,0.02)",
                      border: `1px solid ${preset === p.value ? "rgba(255,215,0,0.25)" : "rgba(255,255,255,0.06)"}`,
                      color: preset === p.value ? "rgba(255,215,0,0.9)" : "rgba(255,255,255,0.4)",
                      fontWeight: preset === p.value ? 700 : 400,
                    }}
                  >
                    {p.label}
                    <span className="block text-[7px] mt-0.5" style={{ opacity: 0.5 }}>{p.count} col</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Individual toggles */}
            <div className="px-3 py-2.5 max-h-[300px] overflow-y-auto space-y-1">
              <div className="text-[8px] tracking-widest mb-1.5" style={{ color: "rgba(255,255,255,0.25)" }}>COLONNES</div>
              {ALL_COLUMNS.map(col => {
                const active = visibleColumns.has(col.key);
                const isRequired = !!col.required;
                return (
                  <button
                    key={col.key}
                    onClick={() => !isRequired && toggleColumn(col.key)}
                    className="flex items-center gap-2 w-full px-2 py-1 rounded transition-all hover:bg-white/[0.03]"
                    style={{ opacity: isRequired ? 0.5 : 1 }}
                    disabled={isRequired}
                  >
                    <span
                      className="w-3.5 h-3.5 rounded border flex items-center justify-center text-[8px]"
                      style={{
                        background: active ? "rgba(255,215,0,0.15)" : "transparent",
                        borderColor: active ? "rgba(255,215,0,0.4)" : "rgba(255,255,255,0.12)",
                        color: active ? "rgba(255,215,0,0.9)" : "transparent",
                      }}
                    >
                      {active ? "✓" : ""}
                    </span>
                    <span style={{ color: active ? "rgba(255,255,255,0.7)" : "rgba(255,255,255,0.3)" }}>
                      {col.label}
                    </span>
                    {isRequired && (
                      <span className="ml-auto text-[7px]" style={{ color: "rgba(255,255,255,0.2)" }}>requis</span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
