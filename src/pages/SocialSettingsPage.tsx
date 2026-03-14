import { useState } from "react";
import { useI18n } from "@/lib/i18n";
import { SectionCard, SectionTitle, SettingRow, ToggleButtons } from "@/components/settings/SettingsShared";
import {
  useSocialAccounts,
  useToggleAccount,
  useDeleteAccount,
  useAddAccount,
  type SocialAccount,
} from "@/hooks/use-social-signal";
import { toast } from "sonner";

/* ═══════════════════════════════════════════════════════ */
/*   SETTINGS > SOCIAL — KOL Watchlist Management          */
/* ═══════════════════════════════════════════════════════ */

const GOLD = "hsl(var(--gold))";
const GO = "hsl(var(--signal-go))";
const BREAK = "hsl(var(--signal-break))";
const TIER_COLORS: Record<string, string> = { A: GO, B: GOLD, C: "hsl(var(--muted-foreground))" };
const CAT_ICONS: Record<string, string> = { official: "🏛", influencer: "📢", builder: "🔧", fund: "💰", media: "📰" };
const TIER_OPTIONS = [
  { value: "A", label: "Tier A", weight: 1.0 },
  { value: "B", label: "Tier B", weight: 0.8 },
  { value: "C", label: "Tier C", weight: 0.65 },
];
const CATEGORY_OPTIONS = ["official", "influencer", "builder", "fund", "media"] as const;

/* ── Add Form ── */
function AddAccountForm({ onClose }: { onClose: () => void }) {
  const { lang } = useI18n();
  const fr = lang === "fr";
  const addAccount = useAddAccount();
  const [handle, setHandle] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [tier, setTier] = useState("C");
  const [category, setCategory] = useState("influencer");

  const weight = TIER_OPTIONS.find(t => t.value === tier)?.weight ?? 0.65;

  const submit = () => {
    const h = handle.replace(/^@/, "").trim();
    if (!h) return;
    addAccount.mutate(
      { handle: h, display_name: displayName || h, tier, influence_weight: weight, category, credibility_score: weight },
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
        <input className="font-mono text-[11px] px-3 py-2 rounded-lg border border-border bg-background text-foreground placeholder:text-muted-foreground" placeholder="@handle" value={handle} onChange={e => setHandle(e.target.value)} />
        <input className="font-mono text-[11px] px-3 py-2 rounded-lg border border-border bg-background text-foreground placeholder:text-muted-foreground" placeholder={fr ? "Nom affiché" : "Display name"} value={displayName} onChange={e => setDisplayName(e.target.value)} />
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        {TIER_OPTIONS.map(t => (
          <button key={t.value} onClick={() => setTier(t.value)} className="font-mono text-[9px] px-2.5 py-1 rounded-md border transition-all"
            style={{ borderColor: tier === t.value ? TIER_COLORS[t.value] : "hsl(var(--border))", color: tier === t.value ? TIER_COLORS[t.value] : "hsl(var(--muted-foreground))", background: tier === t.value ? `color-mix(in srgb, ${TIER_COLORS[t.value]} 10%, transparent)` : "transparent" }}>
            {t.label} ({t.weight})
          </button>
        ))}
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        {CATEGORY_OPTIONS.map(c => (
          <button key={c} onClick={() => setCategory(c)} className="font-mono text-[9px] px-2.5 py-1 rounded-md border transition-all"
            style={{ borderColor: category === c ? GOLD : "hsl(var(--border))", color: category === c ? GOLD : "hsl(var(--muted-foreground))", background: category === c ? `${GOLD}12` : "transparent" }}>
            {CAT_ICONS[c]} {c}
          </button>
        ))}
      </div>
      <div className="flex gap-2 justify-end">
        <button onClick={onClose} className="font-mono text-[10px] px-3 py-1.5 rounded-lg border border-border text-muted-foreground hover:text-foreground transition-all">{fr ? "Annuler" : "Cancel"}</button>
        <button onClick={submit} disabled={addAccount.isPending || !handle.trim()} className="font-mono text-[10px] px-3 py-1.5 rounded-lg border transition-all" style={{ borderColor: GOLD, color: GOLD, background: `${GOLD}12` }}>
          {addAccount.isPending ? "⏳" : "✓"} {fr ? "Ajouter" : "Add"}
        </button>
      </div>
    </div>
  );
}

/* ── Account Row ── */
function AccountRow({ account }: { account: SocialAccount }) {
  const { lang } = useI18n();
  const fr = lang === "fr";
  const toggle = useToggleAccount();
  const remove = useDeleteAccount();

  return (
    <div className="flex items-center gap-3 px-5 py-2.5 border-b border-border last:border-0 group">
      <span className="font-mono text-[9px] font-bold w-5 text-center" style={{ color: TIER_COLORS[account.tier] }}>{account.tier}</span>
      <span className="text-xs">{CAT_ICONS[account.category] || "👤"}</span>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="font-mono text-[11px] text-foreground truncate">@{account.handle}</span>
        </div>
        {account.display_name && account.display_name !== account.handle && (
          <div className="font-mono text-[9px] text-muted-foreground truncate">{account.display_name}</div>
        )}
      </div>
      <span className="font-mono text-[9px] text-muted-foreground">{account.influence_weight.toFixed(2)}</span>
      <span className="font-mono text-[8px] text-muted-foreground">cred: {account.credibility_score.toFixed(2)}</span>
      <button onClick={() => toggle.mutate({ id: account.id, is_active: !account.is_active })}
        className="font-mono text-[9px] px-2 py-1 rounded border transition-all"
        style={{ borderColor: account.is_active ? `${GO}40` : "hsl(var(--border))", color: account.is_active ? GO : "hsl(var(--muted-foreground))", opacity: account.is_active ? 1 : 0.4 }}>
        {account.is_active ? "ON" : "OFF"}
      </button>
      <button onClick={() => { if (confirm(fr ? `Supprimer @${account.handle} ?` : `Delete @${account.handle}?`)) remove.mutate(account.id, { onSuccess: () => toast.success(fr ? "Supprimé" : "Deleted"), onError: (e: any) => toast.error(e.message) }); }}
        className="font-mono text-[9px] text-destructive/50 hover:text-destructive transition-all opacity-0 group-hover:opacity-100">✕</button>
    </div>
  );
}

/* ── Settings Config ── */
function SocialConfig({ fr }: { fr: boolean }) {
  const [selfMention, setSelfMention] = useState(() => { try { return localStorage.getItem("social_include_self") !== "false"; } catch { return true; } });
  const [includeReposts, setIncludeReposts] = useState(() => { try { return localStorage.getItem("social_include_reposts") !== "false"; } catch { return true; } });
  const [timeWindow, setTimeWindow] = useState<"6h" | "24h" | "72h">(() => { try { return (localStorage.getItem("social_time_window") as any) || "24h"; } catch { return "24h"; } });
  const [buzzThreshold, setBuzzThreshold] = useState(() => { try { return Number(localStorage.getItem("social_buzz_threshold")) || 3; } catch { return 3; } });
  const [pumpThreshold, setPumpThreshold] = useState(() => { try { return Number(localStorage.getItem("social_pump_threshold")) || 50; } catch { return 50; } });

  const save = (key: string, val: string) => { try { localStorage.setItem(key, val); } catch {} };

  return (
    <SectionCard>
      <SectionTitle icon="⚙" title={fr ? "Configuration du signal social" : "Social signal configuration"} />

      <SettingRow label={fr ? "Inclure self-mentions" : "Include self-mentions"} description={fr ? "Compter les mentions quand un builder parle de son propre subnet" : "Count mentions when a builder talks about their own subnet"}>
        <ToggleButtons options={[{ value: "true", label: fr ? "Oui" : "Yes" }, { value: "false", label: "Non" }]} value={String(selfMention)} onChange={v => { setSelfMention(v === "true"); save("social_include_self", v); }} />
      </SettingRow>

      <SettingRow label={fr ? "Inclure reposts" : "Include reposts"} description={fr ? "Compter les reposts dans le scoring" : "Count reposts in scoring"}>
        <ToggleButtons options={[{ value: "true", label: fr ? "Oui" : "Yes" }, { value: "false", label: "Non" }]} value={String(includeReposts)} onChange={v => { setIncludeReposts(v === "true"); save("social_include_reposts", v); }} />
      </SettingRow>

      <SettingRow label={fr ? "Fenêtre temporelle" : "Time window"} description={fr ? "Période d'analyse des signaux sociaux" : "Social signal analysis window"}>
        <ToggleButtons options={[{ value: "6h", label: "6h" }, { value: "24h", label: "24h" }, { value: "72h", label: "72h" }]} value={timeWindow} onChange={v => { setTimeWindow(v as any); save("social_time_window", v); }} />
      </SettingRow>

      <SettingRow label={fr ? "Seuil buzz multi-comptes" : "Multi-account buzz threshold"} description={fr ? `Alerte si ≥ ${buzzThreshold} comptes mentionnent le même subnet` : `Alert if ≥ ${buzzThreshold} accounts mention same subnet`}>
        <div className="flex items-center gap-3">
          <input type="range" min={2} max={8} step={1} value={buzzThreshold} onChange={e => { const v = Number(e.target.value); setBuzzThreshold(v); save("social_buzz_threshold", String(v)); }} className="w-20 h-1.5" style={{ accentColor: GOLD }} />
          <span className="font-mono text-[11px] font-bold min-w-[2ch] text-right" style={{ color: GOLD }}>{buzzThreshold}</span>
        </div>
      </SettingRow>

      <SettingRow label={fr ? "Seuil pump risk" : "Pump risk threshold"} description={fr ? `Alerte si pump_risk_score ≥ ${pumpThreshold}` : `Alert if pump_risk_score ≥ ${pumpThreshold}`}>
        <div className="flex items-center gap-3">
          <input type="range" min={20} max={80} step={5} value={pumpThreshold} onChange={e => { const v = Number(e.target.value); setPumpThreshold(v); save("social_pump_threshold", String(v)); }} className="w-20 h-1.5" style={{ accentColor: GOLD }} />
          <span className="font-mono text-[11px] font-bold min-w-[3ch] text-right" style={{ color: GOLD }}>{pumpThreshold}%</span>
        </div>
      </SettingRow>
    </SectionCard>
  );
}

/* ── Main Page ── */
export default function SocialSettingsPage() {
  const { lang } = useI18n();
  const fr = lang === "fr";
  const { data: accounts = [], isLoading, error } = useSocialAccounts();
  const [showAdd, setShowAdd] = useState(false);
  const [filterTier, setFilterTier] = useState<string | null>(null);

  const filtered = filterTier ? accounts.filter(a => a.tier === filterTier) : accounts;
  const activeCount = accounts.filter(a => a.is_active).length;

  return (
    <div className="min-h-full w-full bg-background text-foreground pb-8">
      <div className="px-4 sm:px-6 py-5 max-w-[700px] mx-auto space-y-6">

        <div>
          <h1 className="font-mono text-lg sm:text-xl tracking-wider text-gold">Social Signal</h1>
          <p className="font-mono text-[10px] text-muted-foreground mt-1 leading-relaxed">
            {fr ? "Gestion de la watchlist KOL et configuration du signal social." : "KOL watchlist management and social signal configuration."}
          </p>
        </div>

        {/* Rules */}
        <SectionCard>
          <SectionTitle icon="📋" title={fr ? "Règles du signal social" : "Social signal rules"} />
          <div className="px-5 py-3 space-y-1.5">
            {[
              fr ? "Le signal social ne peut jamais annuler un risque critique" : "Social signal can never override a critical risk",
              fr ? "Un compte officiel pèse plus qu'un compte projet" : "Official accounts weigh more than project accounts",
              fr ? "Un repost / quote / reply < post original" : "Repost / quote / reply < original post",
              fr ? "Un builder mentionnant son propre subnet = self-mention (poids réduit)" : "Builder mentioning own subnet = self-mention (reduced weight)",
              fr ? "Peut renforcer ENTRER ou SURVEILLER, créer alerte buzz/pump" : "Can reinforce ENTER or MONITOR, create buzz/pump alerts",
            ].map((rule, i) => (
              <div key={i} className="flex items-start gap-2 py-1">
                <span className="font-mono text-[9px] text-gold mt-0.5">{i + 1}.</span>
                <span className="font-mono text-[9px] text-muted-foreground leading-relaxed">{rule}</span>
              </div>
            ))}
          </div>
        </SectionCard>

        {/* Watchlist */}
        <SectionCard>
          <SectionTitle icon="👁" title={fr ? "Watchlist KOL" : "KOL Watchlist"} badge={<span className="font-mono text-[8px] text-muted-foreground">{activeCount}/{accounts.length} {fr ? "actifs" : "active"}</span>} />
          <div className="flex items-center justify-between px-5 py-2.5 border-b border-border">
            <div className="flex items-center gap-1.5">
              <button onClick={() => setFilterTier(null)} className="font-mono text-[9px] px-2 py-1 rounded border transition-all" style={{ borderColor: !filterTier ? GOLD : "hsl(var(--border))", color: !filterTier ? GOLD : "hsl(var(--muted-foreground))" }}>{fr ? "Tous" : "All"}</button>
              {TIER_OPTIONS.map(t => (
                <button key={t.value} onClick={() => setFilterTier(filterTier === t.value ? null : t.value)} className="font-mono text-[9px] px-2 py-1 rounded border transition-all" style={{ borderColor: filterTier === t.value ? TIER_COLORS[t.value] : "hsl(var(--border))", color: filterTier === t.value ? TIER_COLORS[t.value] : "hsl(var(--muted-foreground))" }}>
                  {t.label}
                </button>
              ))}
            </div>
            <button onClick={() => setShowAdd(!showAdd)} className="font-mono text-[9px] px-2.5 py-1 rounded-lg border transition-all" style={{ borderColor: GOLD, color: GOLD, background: showAdd ? `${GOLD}12` : "transparent" }}>
              {showAdd ? "✕" : "+"} {fr ? (showAdd ? "Fermer" : "Ajouter") : (showAdd ? "Close" : "Add")}
            </button>
          </div>

          {showAdd && <AddAccountForm onClose={() => setShowAdd(false)} />}

          {isLoading ? (
            <div className="px-5 py-8 text-center"><span className="font-mono text-[10px] text-muted-foreground animate-pulse">…</span></div>
          ) : error ? (
            <div className="px-5 py-4"><span className="font-mono text-[10px] text-destructive">{(error as Error).message}</span></div>
          ) : filtered.length === 0 ? (
            <div className="px-5 py-8 text-center"><span className="font-mono text-[10px] text-muted-foreground">{fr ? "Aucun compte" : "No accounts"}</span></div>
          ) : (
            <div>{filtered.map(a => <AccountRow key={a.id} account={a} />)}</div>
          )}
        </SectionCard>

        {/* Configuration */}
        <SocialConfig fr={fr} />

        {/* Category legend */}
        <SectionCard>
          <SectionTitle icon="🏷" title={fr ? "Catégories" : "Categories"} />
          <div className="px-5 py-3 grid grid-cols-2 sm:grid-cols-3 gap-2">
            {CATEGORY_OPTIONS.map(c => (
              <div key={c} className="flex items-center gap-2 font-mono text-[9px] text-muted-foreground">
                <span>{CAT_ICONS[c]}</span>
                <span className="capitalize">{c}</span>
              </div>
            ))}
          </div>
        </SectionCard>
      </div>
    </div>
  );
}
