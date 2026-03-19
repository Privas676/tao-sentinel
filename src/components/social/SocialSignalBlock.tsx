import { useI18n } from "@/lib/i18n";
import { useSocialSubnetData } from "@/hooks/use-social-signal";
import { computeSocialOverlay, socialBadgeColor, alertSeverityIcon } from "@/lib/social-signal";
import type { FinalAction } from "@/lib/subnet-decision";

/* ═══════════════════════════════════════════════════════ */
/*   SOCIAL SIGNAL BLOCK — Subnet Detail Integration       */
/* ═══════════════════════════════════════════════════════ */

const GOLD = "hsl(var(--gold))";
const GO = "hsl(var(--signal-go))";
const BREAK = "hsl(var(--signal-break))";

function MetricBar({ label, value, max = 100, color }: { label: string; value: number; max?: number; color: string }) {
  const pct = Math.min((value / max) * 100, 100);
  return (
    <div className="space-y-0.5">
      <div className="flex justify-between">
        <span className="font-mono text-[8px] text-muted-foreground">{label}</span>
        <span className="font-mono text-[9px] font-bold" style={{ color }}>{Math.round(value)}</span>
      </div>
      <div className="h-1 rounded-full bg-border overflow-hidden">
        <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: color }} />
      </div>
    </div>
  );
}

export default function SocialSignalBlock({ subnetUid, finalAction }: { subnetUid: number; finalAction: FinalAction }) {
  const { lang } = useI18n();
  const fr = lang === "fr";
  const { score, alerts, isLoading } = useSocialSubnetData(subnetUid);

  if (subnetUid === 0) return null; // SN-0 excluded

  const overlay = computeSocialOverlay(
    score ? {
      socialConviction: score.social_conviction_score,
      socialHeat: score.social_heat_score,
      pumpRisk: score.pump_risk_score,
      smartKolScore: score.smart_kol_score,
      narrativeStrength: score.narrative_strength,
      finalSignal: score.final_social_signal as any,
    } : null,
    alerts.map(a => ({ alert_type: a.alert_type as any, severity: a.severity })),
    finalAction,
    fr,
  );

  if (isLoading) {
    return (
      <div className="rounded-xl border border-border bg-card p-4">
        <span className="font-mono text-[10px] text-muted-foreground animate-pulse">…</span>
      </div>
    );
  }

  if (!overlay.hasSocialData) {
    return (
      <div className="rounded-xl border border-border bg-card p-4">
        <div className="flex items-center gap-2 mb-2">
          <span className="text-sm">📡</span>
          <span className="font-mono text-[10px] tracking-[0.12em] uppercase text-gold">Social Signal</span>
        </div>
        <p className="font-mono text-[9px] text-muted-foreground">
          {fr ? "Pipeline social non connecté — aucune donnée disponible." : "Social pipeline not connected — no data available."}
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
        <span className="text-sm">📡</span>
        <span className="font-mono text-[10px] tracking-[0.12em] uppercase text-gold">Social Signal</span>
        <div className="flex items-center gap-1.5 ml-auto flex-wrap justify-end">
          {overlay.badges.map((b, i) => (
            <span key={i} className="font-mono text-[7px] font-bold px-1.5 py-0.5 rounded border"
              style={{
                borderColor: `${socialBadgeColor(b.type)}40`,
                color: socialBadgeColor(b.type),
                background: `${socialBadgeColor(b.type)}10`,
              }}>
              {fr ? b.label : b.labelEn}
            </span>
          ))}
        </div>
      </div>

      {/* Metrics */}
      <div className="px-4 py-3 grid grid-cols-2 gap-3">
        <MetricBar label={fr ? "Conviction" : "Conviction"} value={overlay.socialConviction} color={GO} />
        <MetricBar label="Smart KOL" value={overlay.smartKolScore} color={GO} />
        <MetricBar label={fr ? "Chaleur" : "Heat"} value={overlay.socialHeat} color={GOLD} />
        <MetricBar label={fr ? "Narratif" : "Narrative"} value={overlay.narrativeStrength} color={GOLD} />
        <MetricBar label={fr ? "Risque Pump" : "Pump Risk"} value={overlay.pumpRisk} color={BREAK} />
      </div>

      {/* Transparency + Signal */}
      {score && (
        <div className="px-4 py-2.5 border-t border-border space-y-1.5">
          <div className="flex items-center gap-4 font-mono text-[8px] text-muted-foreground flex-wrap">
            <span>{score.raw_mention_count} {fr ? "mentions" : "mentions"}</span>
            <span>{score.unique_account_count} {fr ? "comptes" : "accounts"}</span>
            <span>{fr ? "Fenêtre" : "Window"}: 7j</span>
            <span>{fr ? "Score du" : "From"} {score.score_date}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="font-mono text-[9px] font-bold uppercase" style={{ 
              color: overlay.finalSignal === "bullish" ? GO 
                : overlay.finalSignal === "positive" ? GO
                : overlay.finalSignal === "bearish" ? BREAK 
                : overlay.finalSignal === "caution" ? GOLD
                : overlay.finalSignal === "pump_risk" ? BREAK
                : "hsl(var(--muted-foreground))" 
            }}>
              {overlay.finalSignal === "positive" ? "POSITIVE" 
                : overlay.finalSignal === "caution" ? "CAUTION"
                : overlay.finalSignal.toUpperCase()}
            </span>
            <span className="font-mono text-[7px] text-muted-foreground/50">
              {fr ? "· enrichit la décision, ne remplace pas les faits" : "· enriches decision, does not replace facts"}
            </span>
          </div>
        </div>
      )}

      {/* Conflict / Reinforcement messages */}
      {overlay.conflictMessage && (
        <div className="px-4 py-2 border-t border-border">
          <div className="font-mono text-[8px] px-3 py-2 rounded-lg border" style={{ borderColor: `${BREAK}30`, background: `${BREAK}05`, color: `${BREAK}` }}>
            ⚠️ {overlay.conflictMessage}
          </div>
        </div>
      )}
      {overlay.reinforcementMessage && !overlay.conflictMessage && (
        <div className="px-4 py-2 border-t border-border">
          <div className="font-mono text-[8px] px-3 py-2 rounded-lg border" style={{ borderColor: `${GO}30`, background: `${GO}05`, color: GO }}>
            ✅ {overlay.reinforcementMessage}
          </div>
        </div>
      )}

      {/* Active alerts for this subnet */}
      {alerts.length > 0 && (
        <div className="px-4 py-2 border-t border-border space-y-1">
          {alerts.slice(0, 3).map(a => (
            <div key={a.id} className="flex items-center gap-2 font-mono text-[8px] text-muted-foreground">
              <span className="text-[10px]">{alertSeverityIcon(a.severity)}</span>
              <span className="truncate">{a.title}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
