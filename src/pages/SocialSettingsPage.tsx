import { useState } from "react";
import { useI18n } from "@/lib/i18n";
import { SectionCard, SectionTitle, SettingRow } from "@/components/settings/SettingsShared";
import { useSocialKols, useToggleKol, useDeleteKol, useAddKol, type SocialKol } from "@/hooks/use-social-kols";
import { toast } from "sonner";

const TIER_COLORS: Record<string, string> = {
  A: "hsl(var(--signal-go))",
  B: "hsl(var(--gold))",
  C: "hsl(var(--muted-foreground))",
};

const CATEGORY_ICONS: Record<string, string> = {
  official: "🏛",
  influencer: "📢",
  builder: "🔧",
  fund: "💰",
  media: "📰",
};

const TIER_OPTIONS = [
  { value: "A", label: "Tier A", weight: 1.0 },
  { value: "B", label: "Tier B", weight: 0.8 },
  { value: "C", label: "Tier C", weight: 0.65 },
];

const CATEGORY_OPTIONS = ["official", "influencer", "builder", "fund", "media"] as const;

function AddKolForm({ onClose }: { onClose: () => void }) {
  const { lang } = useI18n();
  const fr = lang === "fr";
  const addKol = useAddKol();
  const [handle, setHandle] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [tier, setTier] = useState("C");
  const [category, setCategory] = useState("influencer");

  const weight = TIER_OPTIONS.find(t => t.value === tier)?.weight ?? 0.65;

  const submit = () => {
    const h = handle.replace(/^@/, "").trim();
    if (!h) return;
    addKol.mutate(
      { handle: h, display_name: displayName || h, tier, influence_weight: weight, category },
      {
        onSuccess: () => { toast.success(fr ? "Compte ajouté" : "Account added"); onClose(); },
        onError: (e: any) => toast.error(e.message),
      }
    );
  };

  return (
    <div className="px-5 py-4 border-b border-border space-y-3 bg-muted/20">
      <div className="font-mono text-[10px] tracking-widest uppercase text-gold mb-2">
        {fr ? "AJOUTER UN COMPTE" : "ADD ACCOUNT"}
      </div>
      <div className="grid grid-cols-2 gap-2">
        <input
          className="font-mono text-[11px] px-3 py-2 rounded-lg border border-border bg-background text-foreground placeholder:text-muted-foreground"
          placeholder="@handle"
          value={handle}
          onChange={e => setHandle(e.target.value)}
        />
        <input
          className="font-mono text-[11px] px-3 py-2 rounded-lg border border-border bg-background text-foreground placeholder:text-muted-foreground"
          placeholder={fr ? "Nom affiché" : "Display name"}
          value={displayName}
          onChange={e => setDisplayName(e.target.value)}
        />
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        {TIER_OPTIONS.map(t => (
          <button key={t.value} onClick={() => setTier(t.value)}
            className="font-mono text-[9px] px-2.5 py-1 rounded-md border transition-all"
            style={{
              borderColor: tier === t.value ? TIER_COLORS[t.value] : "hsl(var(--border))",
              color: tier === t.value ? TIER_COLORS[t.value] : "hsl(var(--muted-foreground))",
              background: tier === t.value ? `color-mix(in srgb, ${TIER_COLORS[t.value]} 10%, transparent)` : "transparent",
            }}>
            {t.label} ({t.weight})
          </button>
        ))}
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        {CATEGORY_OPTIONS.map(c => (
          <button key={c} onClick={() => setCategory(c)}
            className="font-mono text-[9px] px-2.5 py-1 rounded-md border transition-all"
            style={{
              borderColor: category === c ? "hsl(var(--gold))" : "hsl(var(--border))",
              color: category === c ? "hsl(var(--gold))" : "hsl(var(--muted-foreground))",
              background: category === c ? "hsla(var(--gold), 0.08)" : "transparent",
            }}>
            {CATEGORY_ICONS[c]} {c}
          </button>
        ))}
      </div>
      <div className="flex gap-2 justify-end">
        <button onClick={onClose}
          className="font-mono text-[10px] px-3 py-1.5 rounded-lg border border-border text-muted-foreground hover:text-foreground transition-all">
          {fr ? "Annuler" : "Cancel"}
        </button>
        <button onClick={submit} disabled={addKol.isPending || !handle.trim()}
          className="font-mono text-[10px] px-3 py-1.5 rounded-lg border transition-all"
          style={{ borderColor: "hsl(var(--gold))", color: "hsl(var(--gold))", background: "hsla(var(--gold), 0.08)" }}>
          {addKol.isPending ? "⏳" : "✓"} {fr ? "Ajouter" : "Add"}
        </button>
      </div>
    </div>
  );
}

function KolRow({ kol }: { kol: SocialKol }) {
  const { lang } = useI18n();
  const fr = lang === "fr";
  const toggle = useToggleKol();
  const remove = useDeleteKol();

  return (
    <div className="flex items-center gap-3 px-5 py-2.5 border-b border-border last:border-0 group">
      {/* Tier badge */}
      <span className="font-mono text-[9px] font-bold w-5 text-center" style={{ color: TIER_COLORS[kol.tier] }}>
        {kol.tier}
      </span>

      {/* Category icon */}
      <span className="text-xs">{CATEGORY_ICONS[kol.category] || "👤"}</span>

      {/* Handle + name */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="font-mono text-[11px] text-foreground truncate">@{kol.handle}</span>
          {kol.self_mention && (
            <span className="font-mono text-[7px] px-1 py-0.5 rounded bg-amber-500/10 text-amber-500 border border-amber-500/20">
              SELF
            </span>
          )}
        </div>
        {kol.display_name && kol.display_name !== kol.handle && (
          <div className="font-mono text-[9px] text-muted-foreground truncate">{kol.display_name}</div>
        )}
      </div>

      {/* Weight */}
      <span className="font-mono text-[9px] text-muted-foreground">{kol.influence_weight.toFixed(2)}</span>

      {/* Toggle active */}
      <button
        onClick={() => toggle.mutate({ id: kol.id, is_active: !kol.is_active })}
        className="font-mono text-[9px] px-2 py-1 rounded border transition-all"
        style={{
          borderColor: kol.is_active ? "hsl(var(--signal-go) / 0.3)" : "hsl(var(--border))",
          color: kol.is_active ? "hsl(var(--signal-go))" : "hsl(var(--muted-foreground))",
          opacity: kol.is_active ? 1 : 0.4,
        }}>
        {kol.is_active ? "ON" : "OFF"}
      </button>

      {/* Delete */}
      <button
        onClick={() => {
          if (confirm(fr ? `Supprimer @${kol.handle} ?` : `Delete @${kol.handle}?`)) {
            remove.mutate(kol.id, {
              onSuccess: () => toast.success(fr ? "Supprimé" : "Deleted"),
              onError: (e: any) => toast.error(e.message),
            });
          }
        }}
        className="font-mono text-[9px] text-destructive/50 hover:text-destructive transition-all opacity-0 group-hover:opacity-100">
        ✕
      </button>
    </div>
  );
}

export default function SocialSettingsPage() {
  const { lang } = useI18n();
  const fr = lang === "fr";
  const { data: kols = [], isLoading, error } = useSocialKols();
  const [showAdd, setShowAdd] = useState(false);
  const [filterTier, setFilterTier] = useState<string | null>(null);

  const filtered = filterTier ? kols.filter(k => k.tier === filterTier) : kols;
  const activeCount = kols.filter(k => k.is_active).length;

  return (
    <div className="min-h-full w-full bg-background text-foreground pb-8">
      <div className="px-4 sm:px-6 py-5 max-w-[700px] mx-auto space-y-6">

        {/* Header */}
        <div>
          <h1 className="font-mono text-lg sm:text-xl tracking-wider text-gold">
            Social Signal
          </h1>
          <p className="font-mono text-[10px] text-muted-foreground mt-1 leading-relaxed">
            {fr
              ? "Gestion de la watchlist KOL pour le module de signal social."
              : "KOL watchlist management for the social signal module."}
          </p>
        </div>

        {/* Rules reminder */}
        <SectionCard>
          <SectionTitle icon="📋" title={fr ? "Règles du signal social" : "Social signal rules"} />
          <div className="px-5 py-3 space-y-1.5">
            {[
              fr ? "Un compte officiel pèse plus qu'un compte projet" : "Official accounts weigh more than project accounts",
              fr ? "Un repost / quote / reply < post original" : "Repost / quote / reply < original post",
              fr ? "Le signal social ne peut jamais annuler un risque critique" : "Social signal can never override a critical risk",
              fr ? "Peut renforcer ENTRER ou SURVEILLER uniquement" : "Can only reinforce ENTER or MONITOR signals",
              fr ? "Peut créer une alerte buzz / pump" : "Can create a buzz / pump alert",
            ].map((rule, i) => (
              <div key={i} className="flex items-start gap-2 py-1">
                <span className="font-mono text-[9px] text-gold mt-0.5">{i + 1}.</span>
                <span className="font-mono text-[9px] text-muted-foreground leading-relaxed">{rule}</span>
              </div>
            ))}
          </div>
        </SectionCard>

        {/* KOL Watchlist */}
        <SectionCard>
          <SectionTitle
            icon="👁"
            title={fr ? "Watchlist KOL" : "KOL Watchlist"}
            badge={
              <span className="font-mono text-[8px] text-muted-foreground">
                {activeCount}/{kols.length} {fr ? "actifs" : "active"}
              </span>
            }
          />

          {/* Toolbar */}
          <div className="flex items-center justify-between px-5 py-2.5 border-b border-border">
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => setFilterTier(null)}
                className="font-mono text-[9px] px-2 py-1 rounded border transition-all"
                style={{
                  borderColor: !filterTier ? "hsl(var(--gold))" : "hsl(var(--border))",
                  color: !filterTier ? "hsl(var(--gold))" : "hsl(var(--muted-foreground))",
                }}>
                {fr ? "Tous" : "All"}
              </button>
              {TIER_OPTIONS.map(t => (
                <button key={t.value}
                  onClick={() => setFilterTier(filterTier === t.value ? null : t.value)}
                  className="font-mono text-[9px] px-2 py-1 rounded border transition-all"
                  style={{
                    borderColor: filterTier === t.value ? TIER_COLORS[t.value] : "hsl(var(--border))",
                    color: filterTier === t.value ? TIER_COLORS[t.value] : "hsl(var(--muted-foreground))",
                  }}>
                  {t.label}
                </button>
              ))}
            </div>
            <button
              onClick={() => setShowAdd(!showAdd)}
              className="font-mono text-[9px] px-2.5 py-1 rounded-lg border transition-all"
              style={{
                borderColor: "hsl(var(--gold))",
                color: "hsl(var(--gold))",
                background: showAdd ? "hsla(var(--gold), 0.08)" : "transparent",
              }}>
              {showAdd ? "✕" : "+"} {fr ? (showAdd ? "Fermer" : "Ajouter") : (showAdd ? "Close" : "Add")}
            </button>
          </div>

          {/* Add form */}
          {showAdd && <AddKolForm onClose={() => setShowAdd(false)} />}

          {/* List */}
          {isLoading ? (
            <div className="px-5 py-8 text-center">
              <span className="font-mono text-[10px] text-muted-foreground animate-pulse">…</span>
            </div>
          ) : error ? (
            <div className="px-5 py-4">
              <span className="font-mono text-[10px] text-destructive">
                {fr ? "Erreur de chargement" : "Loading error"}: {(error as Error).message}
              </span>
            </div>
          ) : filtered.length === 0 ? (
            <div className="px-5 py-8 text-center">
              <span className="font-mono text-[10px] text-muted-foreground">
                {fr ? "Aucun compte trouvé" : "No accounts found"}
              </span>
            </div>
          ) : (
            <div>
              {filtered.map(kol => <KolRow key={kol.id} kol={kol} />)}
            </div>
          )}
        </SectionCard>

        {/* Category legend */}
        <SectionCard>
          <SectionTitle icon="🏷" title={fr ? "Catégories" : "Categories"} />
          <div className="px-5 py-3 grid grid-cols-2 sm:grid-cols-3 gap-2">
            {CATEGORY_OPTIONS.map(c => (
              <div key={c} className="flex items-center gap-2 font-mono text-[9px] text-muted-foreground">
                <span>{CATEGORY_ICONS[c]}</span>
                <span className="capitalize">{c}</span>
              </div>
            ))}
          </div>
        </SectionCard>

      </div>
    </div>
  );
}
