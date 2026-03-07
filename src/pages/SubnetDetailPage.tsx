import { useParams, Link } from "react-router-dom";
import { useI18n } from "@/lib/i18n";

/* ═══════════════════════════════════════ */
/*   SUBNET DETAIL — /subnets/:id          */
/*   Vue approfondie d'un subnet unique    */
/* ═══════════════════════════════════════ */

function DetailSection({ title, icon, children }: { title: string; icon: string; children?: React.ReactNode }) {
  return (
    <div
      className="rounded-xl p-5"
      style={{
        background: "linear-gradient(135deg, hsla(0,0%,100%,0.02) 0%, hsla(0,0%,100%,0.005) 100%)",
        border: "1px solid hsla(0,0%,100%,0.06)",
      }}
    >
      <div className="flex items-center gap-2 mb-4">
        <span className="text-sm">{icon}</span>
        <h3 className="font-mono text-[11px] tracking-widest uppercase" style={{ color: "hsl(var(--gold))" }}>
          {title}
        </h3>
      </div>
      {children ?? (
        <div className="space-y-2">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="h-8 rounded-md animate-pulse"
              style={{ background: "hsla(0,0%,100%,0.02)", width: `${70 + i * 10}%` }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export default function SubnetDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { lang } = useI18n();
  const fr = lang === "fr";
  const netuid = parseInt(id || "0", 10);

  return (
    <div className="h-full w-full bg-background text-foreground p-4 sm:p-6 overflow-auto">
      {/* ── Breadcrumb ── */}
      <div className="flex items-center gap-2 mb-5">
        <Link
          to="/subnets"
          className="font-mono text-[10px] tracking-wider text-muted-foreground/40 hover:text-muted-foreground/70 transition-colors"
        >
          ← Subnets
        </Link>
        <span className="font-mono text-[10px] text-muted-foreground/20">/</span>
        <span className="font-mono text-[10px] text-muted-foreground/60">#{netuid}</span>
      </div>

      {/* ── Header ── */}
      <div className="flex items-center gap-4 mb-6">
        <div
          className="w-12 h-12 rounded-xl flex items-center justify-center font-mono text-lg font-bold"
          style={{
            background: "hsla(var(--gold), 0.08)",
            color: "hsl(var(--gold))",
            border: "1px solid hsla(var(--gold), 0.15)",
          }}
        >
          {netuid}
        </div>
        <div>
          <h2 className="font-mono text-sm tracking-wider" style={{ color: "hsl(var(--gold))" }}>
            Subnet #{netuid}
          </h2>
          <span className="font-mono text-[9px] text-muted-foreground/40">
            {fr ? "Détail et diagnostic" : "Detail & diagnostics"}
          </span>
        </div>

        {/* Verdict placeholder */}
        <div className="ml-auto flex items-center gap-2">
          <span
            className="font-mono text-[10px] px-3 py-1 rounded-full"
            style={{ background: "hsla(0,0%,100%,0.04)", color: "hsl(var(--muted-foreground))" }}
          >
            {fr ? "Verdict: —" : "Verdict: —"}
          </span>
        </div>
      </div>

      {/* ── Detail Grid ── */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <DetailSection icon="📈" title={fr ? "Prix & Performance" : "Price & Performance"} />
        <DetailSection icon="🎯" title={fr ? "Score & Facteurs" : "Score & Factors"} />
        <DetailSection icon="⛏️" title={fr ? "Mineurs & Validateurs" : "Miners & Validators"} />
        <DetailSection icon="💧" title={fr ? "Liquidité & Volume" : "Liquidity & Volume"} />
        <DetailSection icon="🐋" title="Smart Money" />
        <DetailSection icon="⚠️" title={fr ? "Risques" : "Risks"} />
      </div>

      {/* ── Action placeholder ── */}
      <div
        className="mt-6 rounded-xl p-4 flex items-center justify-between"
        style={{
          background: "hsla(var(--gold), 0.03)",
          border: "1px solid hsla(var(--gold), 0.08)",
        }}
      >
        <span className="font-mono text-[10px] text-muted-foreground/50">
          {fr ? "Actions de position" : "Position actions"}
        </span>
        <div className="flex gap-2">
          {["ENTER", "HOLD", "EXIT"].map((a) => (
            <span
              key={a}
              className="font-mono text-[9px] px-3 py-1 rounded-md"
              style={{ background: "hsla(0,0%,100%,0.04)", color: "hsl(var(--muted-foreground))" }}
            >
              {a}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
