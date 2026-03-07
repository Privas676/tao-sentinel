import { useI18n } from "@/lib/i18n";
import { Link } from "react-router-dom";

/* ═══════════════════════════════════════ */
/*   COMPASS — Executive Decision View     */
/*   Résumé décisionnel macro + signaux    */
/* ═══════════════════════════════════════ */

function SectionPlaceholder({ title, description, icon }: { title: string; description: string; icon: string }) {
  return (
    <div
      className="rounded-xl p-6"
      style={{
        background: "linear-gradient(135deg, hsla(0,0%,100%,0.02) 0%, hsla(0,0%,100%,0.005) 100%)",
        border: "1px solid hsla(0,0%,100%,0.06)",
      }}
    >
      <div className="flex items-center gap-3 mb-3">
        <span className="text-lg">{icon}</span>
        <h3 className="font-mono text-xs tracking-widest uppercase" style={{ color: "hsl(var(--gold))" }}>
          {title}
        </h3>
      </div>
      <p className="font-mono text-[10px] text-muted-foreground/50 leading-relaxed">
        {description}
      </p>
      <div className="mt-4 grid grid-cols-3 gap-2">
        {[1, 2, 3].map((i) => (
          <div
            key={i}
            className="h-16 rounded-lg animate-pulse"
            style={{ background: "hsla(0,0%,100%,0.02)" }}
          />
        ))}
      </div>
    </div>
  );
}

export default function CompassPage() {
  const { lang } = useI18n();
  const fr = lang === "fr";

  return (
    <div className="h-full w-full bg-background text-foreground p-4 sm:p-6 overflow-auto">
      {/* ── TAO PRICE HEADER ── */}
      <div className="flex items-center gap-4 mb-6">
        <div
          className="flex items-center gap-2 px-3 py-1.5 rounded-lg"
          style={{ background: "hsla(0,0%,100%,0.03)", border: "1px solid hsla(0,0%,100%,0.06)" }}
        >
          <span className="font-mono text-[10px] text-muted-foreground/50">TAO</span>
          <span className="font-mono text-sm font-semibold" style={{ color: "hsl(var(--gold))" }}>
            —
          </span>
          <span className="font-mono text-[9px] text-muted-foreground/40">USD</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-primary/60 animate-pulse" />
          <span className="font-mono text-[9px] text-muted-foreground/40">
            {fr ? "Données en attente" : "Awaiting data"}
          </span>
        </div>
      </div>

      {/* ── SECTIONS GRID ── */}
      <div className="space-y-4">
        {/* Sentinel Index */}
        <div
          className="rounded-xl p-6 text-center"
          style={{
            background: "linear-gradient(180deg, hsla(40,70%,69%,0.04) 0%, transparent 100%)",
            border: "1px solid hsla(40,70%,69%,0.1)",
          }}
        >
          <span className="font-mono text-[9px] tracking-widest uppercase text-muted-foreground/40 block mb-2">
            Sentinel Index
          </span>
          <span
            className="font-mono text-4xl font-bold block"
            style={{ color: "hsl(var(--gold))", textShadow: "0 0 20px hsla(40,70%,69%,0.2)" }}
          >
            —
          </span>
          <span className="font-mono text-[10px] text-muted-foreground/40 mt-1 block">
            {fr ? "Indice composite global" : "Composite global index"}
          </span>
        </div>

        {/* Grid 2 cols */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <SectionPlaceholder
            icon="📊"
            title={fr ? "Drivers du Moment" : "Current Drivers"}
            description={fr
              ? "Régime macro, Smart Capital, Stabilité globale, Confiance données, Momentum"
              : "Macro regime, Smart Capital, Global Stability, Data Confidence, Momentum"
            }
          />
          <SectionPlaceholder
            icon="🎯"
            title={fr ? "Moteur de Décision" : "Decision Engine"}
            description={fr
              ? "Top 5 RENTRE · Top 5 HOLD · Top 5 SORS — classement par conviction"
              : "Top 5 ENTER · Top 5 HOLD · Top 5 EXIT — ranked by conviction"
            }
          />
        </div>

        {/* Critical Risks */}
        <SectionPlaceholder
          icon="⚠️"
          title={fr ? "Risques Critiques" : "Critical Risks"}
          description={fr
            ? "Subnets avec override manuel, risque depeg, ou delist imminent"
            : "Subnets with manual override, depeg risk, or imminent delisting"
          }
        />

        {/* Quick link to Subnets */}
        <Link
          to="/subnets"
          className="block text-center font-mono text-[10px] tracking-wider py-3 rounded-lg transition-all hover:scale-[1.01]"
          style={{
            background: "hsla(var(--gold), 0.05)",
            color: "hsl(var(--gold))",
            border: "1px solid hsla(var(--gold), 0.1)",
          }}
        >
          {fr ? "Explorer tous les subnets →" : "Explore all subnets →"}
        </Link>
      </div>
    </div>
  );
}
