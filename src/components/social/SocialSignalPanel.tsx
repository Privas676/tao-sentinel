import { useState } from "react";
import { useI18n } from "@/lib/i18n";
import {
  useSocialAccounts,
  useSocialPosts,
  useSocialSubnetScores,
  useSocialAlerts,
  type SocialAccount,
  type SocialPost,
  type SocialSubnetScore,
  type SocialAlert,
} from "@/hooks/use-social-signal";
import { useSocialPostMentions } from "@/hooks/use-social-signal";
import { alertSeverityIcon } from "@/lib/social-signal";
import { SectionCard, SectionTitle } from "@/components/settings/SettingsShared";

/* ═══════════════════════════════════════════════════════ */
/*   LAB > SOCIAL — Social Signal Intelligence Panel       */
/* ═══════════════════════════════════════════════════════ */

const GOLD = "hsl(var(--gold))";
const GO = "hsl(var(--signal-go))";
const BREAK = "hsl(var(--signal-break))";

const TIER_COLORS: Record<string, string> = { A: GO, B: GOLD, C: "hsl(var(--muted-foreground))" };
const CAT_ICONS: Record<string, string> = { official: "🏛", influencer: "📢", builder: "🔧", fund: "💰", media: "📰" };
const SIGNAL_COLORS: Record<string, string> = { bullish: GO, bearish: BREAK, watch: GOLD, pump_risk: BREAK, none: "hsl(var(--muted-foreground))" };

type SocialTab = "leaderboard" | "posts" | "accounts" | "alerts";
const TABS: { key: SocialTab; icon: string; fr: string; en: string }[] = [
  { key: "leaderboard", icon: "🏆", fr: "Leaderboard", en: "Leaderboard" },
  { key: "posts", icon: "📝", fr: "Posts", en: "Posts" },
  { key: "accounts", icon: "👥", fr: "Comptes", en: "Accounts" },
  { key: "alerts", icon: "🚨", fr: "Alertes", en: "Alerts" },
];

/* ── Pipeline Status Banner ── */
function PipelineStatusBanner({ fr, hasPosts, hasScores, latestPostAt, latestScoreDate }: {
  fr: boolean;
  hasPosts: boolean;
  hasScores: boolean;
  latestPostAt: string | null;
  latestScoreDate: string | null;
}) {
  const now = Date.now();
  const postAgeHours = latestPostAt ? (now - new Date(latestPostAt).getTime()) / (1000 * 60 * 60) : Infinity;
  const isStale = hasPosts && postAgeHours > 6;
  const isOffline = !hasPosts && !hasScores;

  if (isOffline) {
    return (
      <div className="rounded-lg border px-4 py-3 flex items-center gap-3"
        style={{ borderColor: "hsl(var(--border))", background: "hsl(var(--muted) / 0.15)" }}>
        <span className="text-base">⚙️</span>
        <div className="flex-1">
          <span className="font-mono text-[10px] font-bold text-foreground/80 block">
            {fr ? "Pipeline social non configuré" : "Social pipeline not configured"}
          </span>
          <span className="font-mono text-[8px] text-muted-foreground block mt-0.5">
            {fr
              ? "Aucune donnée sociale disponible. Le pipeline d'ingestion X/Twitter n'est pas encore branché."
              : "No social data available. The X/Twitter ingestion pipeline is not yet connected."}
          </span>
        </div>
      </div>
    );
  }

  if (isStale) {
    return (
      <div className="rounded-lg border px-4 py-2.5 flex items-center gap-3"
        style={{ borderColor: "rgba(229,57,53,0.25)", background: "rgba(229,57,53,0.05)" }}>
        <span className="text-sm animate-pulse">🔴</span>
        <div className="flex-1">
          <span className="font-mono text-[10px] font-bold block" style={{ color: "rgba(229,57,53,0.85)" }}>
            {fr ? "Feed social obsolète" : "Social feed stale"}
          </span>
          <span className="font-mono text-[8px] text-muted-foreground block mt-0.5">
            {fr ? "Dernier post il y a" : "Last post"} {formatAge(postAgeHours, fr)}
            {latestScoreDate && <> · {fr ? "Dernier score" : "Last score"}: {latestScoreDate}</>}
          </span>
        </div>
      </div>
    );
  }

  // Healthy — show last sync info
  return (
    <div className="rounded-lg border px-4 py-2 flex items-center gap-3"
      style={{ borderColor: `${GO}30`, background: `${GO}05` }}>
      <span className="text-sm">🟢</span>
      <span className="font-mono text-[8px] text-muted-foreground">
        {fr ? "Dernier post" : "Last post"}: {latestPostAt ? timeAgo(latestPostAt, fr) : "—"}
        {latestScoreDate && <> · {fr ? "Score du" : "Score from"} {latestScoreDate}</>}
      </span>
    </div>
  );
}

function formatAge(hours: number, fr: boolean): string {
  if (hours < 1) return fr ? "< 1h" : "< 1h";
  if (hours < 24) return `${Math.floor(hours)}h`;
  const days = Math.floor(hours / 24);
  return `${days}${fr ? "j" : "d"}`;
}

/* ── Leaderboard Tab ── */
function LeaderboardTab({ scores, fr }: { scores: SocialSubnetScore[]; fr: boolean }) {
  if (!scores.length) return <EmptyState fr={fr} text={fr ? "Aucun score social disponible" : "No social scores available"} />;
  return (
    <div className="overflow-x-auto">
      <table className="w-full">
        <thead>
          <tr className="border-b border-border">
            {["Subnet", fr ? "Mentions" : "Mentions", fr ? "Comptes" : "Accounts", "Conviction", "Smart KOL", "Heat", "Pump Risk", fr ? "Signal" : "Signal"].map(h => (
              <th key={h} className="font-mono text-[8px] tracking-widest uppercase text-muted-foreground px-3 py-2 text-left">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {scores.map(s => (
            <tr key={s.id} className="border-b border-border/50 hover:bg-muted/10 transition-colors">
              <td className="font-mono text-[11px] font-bold px-3 py-2.5" style={{ color: GOLD }}>SN-{s.subnet_uid}</td>
              <td className="font-mono text-[10px] px-3 py-2.5 text-foreground/70">{s.raw_mention_count}</td>
              <td className="font-mono text-[10px] px-3 py-2.5 text-foreground/70">{s.unique_account_count}</td>
              <td className="font-mono text-[10px] px-3 py-2.5"><ScorePill value={s.social_conviction_score} /></td>
              <td className="font-mono text-[10px] px-3 py-2.5"><ScorePill value={s.smart_kol_score} /></td>
              <td className="font-mono text-[10px] px-3 py-2.5"><ScorePill value={s.social_heat_score} /></td>
              <td className="font-mono text-[10px] px-3 py-2.5"><ScorePill value={s.pump_risk_score} invert /></td>
              <td className="font-mono text-[9px] font-bold px-3 py-2.5 uppercase" style={{ color: SIGNAL_COLORS[s.final_social_signal] || GOLD }}>
                {s.final_social_signal}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ── Post Source Button ── */
function PostSourceAction({ post, fr }: { post: SocialPost; fr: boolean }) {
  if (!post.url) {
    return (
      <span className="font-mono text-[8px] px-2 py-1 rounded border text-muted-foreground opacity-50"
        style={{ borderColor: "hsl(var(--border))" }}>
        {fr ? "Source non disponible" : "Source unavailable"}
      </span>
    );
  }

  return (
    <a href={post.url} target="_blank" rel="noopener noreferrer"
      className="font-mono text-[8px] px-2 py-1 rounded border transition-all hover:opacity-80"
      style={{ borderColor: `${GOLD}40`, color: GOLD }}>
      → {fr ? "Voir sur X" : "View on X"}
    </a>
  );
}

/* ── Posts Tab ── */
function PostsTab({ posts, fr }: { posts: SocialPost[]; fr: boolean }) {
  const postIds = posts.map(p => p.id);
  const { data: allMentions = [] } = useSocialPostMentions(postIds.length ? postIds : undefined);

  if (!posts.length) return <EmptyState fr={fr} text={fr ? "Aucun post collecté — pipeline en attente de configuration" : "No posts collected — pipeline awaiting configuration"} />;
  return (
    <div className="divide-y divide-border">
      {posts.map(p => {
        const mentions = allMentions.filter(m => m.post_id === p.id);
        const acct = p.account as any;
        return (
          <div key={p.id} className="px-4 py-3 hover:bg-muted/5 transition-colors">
            {/* Author line */}
            <div className="flex items-center gap-2 mb-1.5">
              <span className="text-xs">{CAT_ICONS[acct?.category] || "👤"}</span>
              <span className="font-mono text-[10px] font-bold text-foreground/80">@{acct?.handle}</span>
              {acct?.display_name && acct.display_name !== acct.handle && (
                <span className="font-mono text-[8px] text-muted-foreground">{acct.display_name}</span>
              )}
              <span className="font-mono text-[8px] px-1.5 py-0.5 rounded border border-border text-muted-foreground uppercase">{p.post_type}</span>
              <span className="font-mono text-[8px] text-muted-foreground ml-auto">{timeAgo(p.posted_at, fr)}</span>
            </div>

            {/* Post text */}
            <p className="font-mono text-[10px] text-foreground/60 leading-relaxed line-clamp-2 mb-1.5">{p.clean_text || p.raw_text}</p>

            {/* Mentions + engagement + source action */}
            <div className="flex items-center gap-3 flex-wrap">
              {mentions.map(m => (
                <span key={m.id} className="font-mono text-[8px] px-1.5 py-0.5 rounded border"
                  style={{
                    borderColor: m.sentiment === "bullish" ? `${GO}40` : m.sentiment === "bearish" ? `${BREAK}40` : "hsl(var(--border))",
                    color: m.sentiment === "bullish" ? GO : m.sentiment === "bearish" ? BREAK : "hsl(var(--muted-foreground))",
                  }}>
                  SN-{m.subnet_uid} · {m.sentiment} {m.self_mention ? "· SELF" : ""}
                </span>
              ))}
              <div className="flex items-center gap-2 ml-auto font-mono text-[8px] text-muted-foreground">
                <span>❤️ {p.like_count}</span>
                <span>💬 {p.reply_count}</span>
                <span>🔄 {p.repost_count}</span>
              </div>
              <PostSourceAction post={p} fr={fr} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ── Accounts Tab ── */
function AccountsTab({ accounts, fr }: { accounts: SocialAccount[]; fr: boolean }) {
  if (!accounts.length) return <EmptyState fr={fr} text={fr ? "Aucun compte configuré" : "No accounts configured"} />;
  return (
    <div className="divide-y divide-border">
      {accounts.map(a => (
        <div key={a.id} className="flex items-center gap-3 px-4 py-2.5">
          <span className="font-mono text-[9px] font-bold w-5 text-center" style={{ color: TIER_COLORS[a.tier] }}>{a.tier}</span>
          <span className="text-xs">{CAT_ICONS[a.category] || "👤"}</span>
          <div className="flex-1 min-w-0">
            <span className="font-mono text-[11px] text-foreground truncate block">@{a.handle}</span>
            {a.display_name && <span className="font-mono text-[9px] text-muted-foreground truncate block">{a.display_name}</span>}
          </div>
          <span className="font-mono text-[9px] text-muted-foreground">{a.influence_weight.toFixed(2)}</span>
          <span className="font-mono text-[9px] text-muted-foreground">cred: {a.credibility_score.toFixed(2)}</span>
          <span className="font-mono text-[8px] px-1.5 py-0.5 rounded border"
            style={{
              borderColor: a.is_active ? `${GO}40` : "hsl(var(--border))",
              color: a.is_active ? GO : "hsl(var(--muted-foreground))",
              opacity: a.is_active ? 1 : 0.4,
            }}>
            {a.is_active ? "ON" : "OFF"}
          </span>
        </div>
      ))}
    </div>
  );
}

/* ── Alerts Tab ── */
function AlertsTab({ alerts, fr }: { alerts: SocialAlert[]; fr: boolean }) {
  if (!alerts.length) return <EmptyState fr={fr} text={fr ? "Aucune alerte sociale active" : "No active social alerts"} />;
  return (
    <div className="divide-y divide-border">
      {alerts.map(a => (
        <div key={a.id} className="px-4 py-3 hover:bg-muted/5 transition-colors">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-sm">{alertSeverityIcon(a.severity)}</span>
            <span className="font-mono text-[10px] font-bold text-foreground/80">{a.title}</span>
            <span className="font-mono text-[8px] px-1.5 py-0.5 rounded border border-border text-muted-foreground uppercase ml-auto">{a.alert_type}</span>
          </div>
          {a.description && <p className="font-mono text-[9px] text-muted-foreground leading-relaxed ml-6">{a.description}</p>}
          <div className="flex items-center gap-3 mt-1 ml-6 font-mono text-[8px] text-muted-foreground">
            <span>SN-{a.subnet_uid}</span>
            <span>Sources: {a.source_count}</span>
            <span>Score: {a.weighted_score.toFixed(0)}</span>
            <span className="ml-auto">{timeAgo(a.created_at, fr)}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

/* ── Helpers ── */
function ScorePill({ value, invert }: { value: number; invert?: boolean }) {
  const color = invert
    ? (value >= 50 ? BREAK : value >= 25 ? GOLD : GO)
    : (value >= 60 ? GO : value >= 30 ? GOLD : "hsl(var(--muted-foreground))");
  return (
    <span className="font-mono text-[10px] font-bold" style={{ color }}>{Math.round(value)}</span>
  );
}

function EmptyState({ fr, text }: { fr: boolean; text: string }) {
  return (
    <div className="px-5 py-10 text-center">
      <span className="font-mono text-[10px] text-muted-foreground">{text}</span>
    </div>
  );
}

function timeAgo(ts: string, fr: boolean): string {
  const mins = Math.floor((Date.now() - new Date(ts).getTime()) / 60000);
  if (mins < 1) return fr ? "à l'instant" : "just now";
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  return `${Math.floor(hrs / 24)}d`;
}

/* ── Main Component ── */
export default function SocialSignalPanel() {
  const { lang } = useI18n();
  const fr = lang === "fr";
  const [tab, setTab] = useState<SocialTab>("leaderboard");

  const { data: accounts = [], isLoading: loadingAccts } = useSocialAccounts();
  const { data: posts = [], isLoading: loadingPosts } = useSocialPosts();
  const { data: scores = [], isLoading: loadingScores } = useSocialSubnetScores();
  const { data: alerts = [], isLoading: loadingAlerts } = useSocialAlerts();

  const isLoading = loadingAccts || loadingPosts || loadingScores || loadingAlerts;
  const activeAccounts = accounts.filter(a => a.is_active).length;
  const activeAlerts = alerts.length;

  const latestPostAt = posts.length > 0 ? posts[0].posted_at : null;
  const latestScoreDate = scores.length > 0 ? scores[0].score_date : null;

  return (
    <div className="h-full overflow-y-auto pb-8">
      <div className="px-4 sm:px-6 py-5 max-w-[900px] mx-auto space-y-4">

        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h2 className="font-mono text-sm tracking-wider text-gold flex items-center gap-2">
              📡 Social Signal
            </h2>
            <p className="font-mono text-[9px] text-muted-foreground mt-0.5">
              {fr ? "Intelligence sociale KOL — Détection de narratifs et signaux de conviction" : "KOL social intelligence — Narrative detection and conviction signals"}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <span className="font-mono text-[8px] text-muted-foreground">{activeAccounts} {fr ? "comptes actifs" : "active accounts"}</span>
            {activeAlerts > 0 && (
              <span className="font-mono text-[8px] px-1.5 py-0.5 rounded-full" style={{ background: `${BREAK}20`, color: BREAK }}>
                {activeAlerts} {fr ? "alertes" : "alerts"}
              </span>
            )}
          </div>
        </div>

        {/* Pipeline status */}
        <PipelineStatusBanner
          fr={fr}
          hasPosts={posts.length > 0}
          hasScores={scores.length > 0}
          latestPostAt={latestPostAt}
          latestScoreDate={latestScoreDate}
        />

        {/* Sub-tabs */}
        <div className="flex border-b border-border">
          {TABS.map(t => (
            <button key={t.key} onClick={() => setTab(t.key)}
              className="flex items-center gap-1 px-3 py-2 font-mono text-[9px] tracking-wider transition-all relative"
              style={{ color: tab === t.key ? GOLD : "hsl(var(--muted-foreground))", opacity: tab === t.key ? 1 : 0.5 }}>
              <span className="text-[10px]">{t.icon}</span>
              <span>{fr ? t.fr : t.en}</span>
              {tab === t.key && <span className="absolute bottom-0 left-1 right-1 h-[2px] rounded-full" style={{ background: GOLD }} />}
              {t.key === "alerts" && activeAlerts > 0 && (
                <span className="font-mono text-[7px] px-1 rounded-full ml-0.5" style={{ background: `${BREAK}25`, color: BREAK }}>{activeAlerts}</span>
              )}
            </button>
          ))}
        </div>

        {/* Content */}
        <SectionCard>
          {isLoading ? (
            <div className="px-5 py-10 text-center">
              <span className="font-mono text-[10px] text-muted-foreground animate-pulse">…</span>
            </div>
          ) : (
            <>
              {tab === "leaderboard" && <LeaderboardTab scores={scores} fr={fr} />}
              {tab === "posts" && <PostsTab posts={posts} fr={fr} />}
              {tab === "accounts" && <AccountsTab accounts={accounts} fr={fr} />}
              {tab === "alerts" && <AlertsTab alerts={alerts} fr={fr} />}
            </>
          )}
        </SectionCard>

        {/* Rules reminder */}
        <div className="font-mono text-[8px] text-muted-foreground/50 text-center leading-relaxed px-4">
          {fr
            ? "Le signal social ne peut jamais annuler un risque critique structurel. Il renforce les décisions existantes."
            : "Social signal can never override a critical structural risk. It reinforces existing decisions."}
        </div>
      </div>
    </div>
  );
}
