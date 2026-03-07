import type { ReactNode } from "react";

/* ═══════════════════════════════════════════ */
/*   SHARED DESIGN ATOMS — TAO Sentinel        */
/*   Single source for all decision UI atoms   */
/* ═══════════════════════════════════════════ */

/* ── Design tokens ── */
export const GOLD = "hsl(var(--gold))";
export const GO = "hsl(var(--signal-go))";
export const WARN = "hsl(var(--signal-go-spec))";
export const BREAK = "hsl(var(--signal-break))";
export const MUTED = "hsl(var(--muted-foreground))";

/* ── SectionCard ── */
export function SectionCard({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-xl border border-border bg-card ${className}`}>{children}</div>;
}

/* ── SectionTitle ── */
export function SectionTitle({ icon, title, badge }: { icon: string; title: string; badge?: ReactNode }) {
  return (
    <div className="flex items-center gap-2.5 px-5 py-3 border-b border-border">
      <span className="text-sm opacity-70">{icon}</span>
      <h2 className="font-mono text-[10px] tracking-[0.15em] uppercase text-gold">{title}</h2>
      {badge && <div className="ml-auto">{badge}</div>}
    </div>
  );
}

/* ── KPIChip ── */
export function KPIChip({ label, value, color, sub }: { label: string; value: string | number; color?: string; sub?: string }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg px-2 py-2.5 bg-muted/25 border border-border min-w-0">
      <span className="font-mono text-[7px] text-muted-foreground tracking-[0.18em] uppercase leading-none mb-1">{label}</span>
      <span className="font-mono text-[14px] font-bold leading-none" style={{ color }}>{value}</span>
      {sub && <span className="font-mono text-[8px] text-muted-foreground mt-0.5">{sub}</span>}
    </div>
  );
}

/* ── Metric row ── */
export function Metric({ label, value, color, sub, mono = true }: { label: string; value: string | number; color?: string; sub?: string; mono?: boolean }) {
  return (
    <div className="flex justify-between items-center py-[5px]">
      <span className="text-muted-foreground text-[11px] leading-tight">{label}</span>
      <div className="flex items-center gap-1.5">
        <span className={`text-[12px] font-medium ${mono ? "font-mono" : ""}`} style={{ color: color || "hsl(var(--foreground))" }}>{value}</span>
        {sub && <span className="text-[9px] text-muted-foreground">{sub}</span>}
      </div>
    </div>
  );
}

/* ── Sparkline ── */
export function Sparkline({ data, width = 64, height = 20 }: { data: number[]; width?: number; height?: number }) {
  if (data.length < 2) return <span className="text-muted-foreground text-[9px]">—</span>;
  const min = Math.min(...data), max = Math.max(...data), range = max - min || 1;
  const trend = data[data.length - 1] - data[0];
  const c = trend > 0 ? GO : trend < 0 ? BREAK : MUTED;
  const pts = data.map((v, i) => `${((i / (data.length - 1)) * width).toFixed(1)},${(height - 1 - ((v - min) / range) * (height - 2)).toFixed(1)}`).join(" ");
  return <svg width={width} height={height}><polyline points={pts} fill="none" stroke={c} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}

/* ── BarScore ── */
export function BarScore({ label, value, color }: { label: string; value: number; color?: string }) {
  const pct = Math.min(100, Math.max(0, value));
  return (
    <div className="flex items-center gap-2.5 py-[3px]">
      <span className="text-muted-foreground text-[10px] w-[90px] shrink-0">{label}</span>
      <div className="flex-1 h-[5px] rounded-full overflow-hidden bg-muted/25">
        <div className="h-full rounded-full transition-all duration-500" style={{ width: `${pct}%`, background: color }} />
      </div>
      <span className="font-mono text-[10px] w-7 text-right font-semibold" style={{ color }}>{Math.round(value)}</span>
    </div>
  );
}
