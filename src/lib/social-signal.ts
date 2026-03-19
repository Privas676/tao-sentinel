/* ═══════════════════════════════════════════════════════ */
/*   SOCIAL SIGNAL ENGINE — Analysis, Scoring & Overlay    */
/*   Provides mention detection, weighting, and social     */
/*   overlay integration for the TAO Sentinel decision     */
/*   engine.                                               */
/* ═══════════════════════════════════════════════════════ */

/* ── Types ── */

export type PostType = "original" | "reply" | "quote" | "repost";
export type Sentiment = "bullish" | "neutral" | "bearish";
export type SocialSignal = "none" | "neutral" | "positive" | "bullish" | "caution" | "bearish" | "pump_risk" | "watch";
export type AlertType = "kol_call" | "multi_account_buzz" | "pump_risk" | "bearish_warning" | "official_mention" | "fund_signal" | "builder_update";
export type PostClassification = "MENTION" | "WATCH" | "BULLISH_CALL" | "BEARISH_WARNING" | "ECOSYSTEM_NEWS" | "PROJECT_UPDATE" | "FUND_FLOW_SIGNAL" | "PUMP_SIGNAL";

export type SocialOverlay = {
  hasSocialData: boolean;
  socialConviction: number;
  socialHeat: number;
  pumpRisk: number;
  smartKolScore: number;
  narrativeStrength: number;
  finalSignal: SocialSignal;
  badges: SocialBadge[];
  conflictMessage: string | null;
  reinforcementMessage: string | null;
};

export type SocialBadge = {
  type: "KOL_CALL" | "BUZZ" | "PUMP_RISK" | "BUILDER_UPDATE" | "OFFICIAL_SIGNAL" | "FUND_SIGNAL" | "BEARISH_WARNING";
  label: string;
  labelEn: string;
  severity: "info" | "watch" | "high";
};

/* ── Constants ── */

const ORIGINALITY_FACTOR: Record<PostType, number> = {
  original: 1.00,
  quote: 0.80,
  reply: 0.55,
  repost: 0.35,
};

const SELF_MENTION_PENALTY = 0.35;

/* ── Freshness Factor ── */

export function freshnessWeight(postedAt: Date | string): number {
  const hoursAgo = (Date.now() - new Date(postedAt).getTime()) / (1000 * 60 * 60);
  if (hoursAgo < 6) return 1.00;
  if (hoursAgo < 24) return 0.85;
  if (hoursAgo < 72) return 0.60;
  if (hoursAgo < 168) return 0.35;
  return 0.10;
}

/* ── Post Weight Calculation ── */

export function calculatePostWeight(params: {
  influenceWeight: number;
  credibilityScore: number;
  postType: PostType;
  confidenceExtraction: number;
  postedAt: Date | string;
  isSelfMention: boolean;
}): number {
  const base =
    params.influenceWeight *
    params.credibilityScore *
    ORIGINALITY_FACTOR[params.postType] *
    params.confidenceExtraction *
    freshnessWeight(params.postedAt);

  return params.isSelfMention ? base * (1 - SELF_MENTION_PENALTY) : base;
}

/* ── Mention Detection (regex-based for text analysis) ── */

const SUBNET_PATTERNS = [
  /\bSN[-\s]?(\d{1,3})\b/gi,
  /\bsubnet\s*(\d{1,3})\b/gi,
  /\b#SN(\d{1,3})\b/gi,
];

export function detectSubnetMentions(text: string, knownNames?: Record<number, string>): { netuid: number; type: "direct_uid" | "direct_name" }[] {
  const found = new Map<number, "direct_uid" | "direct_name">();

  for (const pattern of SUBNET_PATTERNS) {
    let match;
    const re = new RegExp(pattern.source, pattern.flags);
    while ((match = re.exec(text)) !== null) {
      const uid = parseInt(match[1], 10);
      if (uid >= 0 && uid <= 255) found.set(uid, "direct_uid");
    }
  }

  if (knownNames) {
    const lower = text.toLowerCase();
    for (const [uid, name] of Object.entries(knownNames)) {
      if (name && lower.includes(name.toLowerCase())) {
        const n = parseInt(uid, 10);
        if (!found.has(n)) found.set(n, "direct_name");
      }
    }
  }

  return Array.from(found.entries()).map(([netuid, type]) => ({ netuid, type }));
}

/* ── Post Classification ── */

const BULLISH_KEYWORDS = /\b(bullish|moon|explode|accumulating|crushing|strong|milestone|breakthrough|100x|buy|long)\b/i;
const BEARISH_KEYWORDS = /\b(bearish|warning|risk|danger|concentrated|sell|dump|exit|short|careful|avoid)\b/i;
const PUMP_KEYWORDS = /\b(explode|100x|get in now|before.?too late|guaranteed|🚀🚀|moon)\b/i;
const FUND_KEYWORDS = /\b(accumulating|position|allocation|portfolio|fund)\b/i;

export function classifyPost(text: string, category: string, isSelfMention: boolean): PostClassification {
  const hasBullish = BULLISH_KEYWORDS.test(text);
  const hasBearish = BEARISH_KEYWORDS.test(text);
  const hasPump = PUMP_KEYWORDS.test(text);
  const hasFund = FUND_KEYWORDS.test(text);

  if (hasPump && !hasBearish) return "PUMP_SIGNAL";
  if (category === "fund" && hasFund) return "FUND_FLOW_SIGNAL";
  if (isSelfMention) return "PROJECT_UPDATE";
  if (category === "official") return "ECOSYSTEM_NEWS";
  if (hasBearish && !hasBullish) return "BEARISH_WARNING";
  if (hasBullish && !hasBearish) return "BULLISH_CALL";
  if (hasBullish || hasBearish) return "WATCH";
  return "MENTION";
}

/* ── Sentiment Analysis (simple keyword-based) ── */

export function analyzeSentiment(text: string): Sentiment {
  const bullishScore = (text.match(BULLISH_KEYWORDS) || []).length;
  const bearishScore = (text.match(BEARISH_KEYWORDS) || []).length;
  if (bullishScore > bearishScore) return "bullish";
  if (bearishScore > bullishScore) return "bearish";
  return "neutral";
}

/* ── Social Overlay Integration ── */

export type FinalAction = "ENTRER" | "SURVEILLER" | "SORTIR" | "ÉVITER" | "SYSTÈME";

export function computeSocialOverlay(
  subnetScore: {
    socialConviction: number;
    socialHeat: number;
    pumpRisk: number;
    smartKolScore: number;
    narrativeStrength: number;
    finalSignal: SocialSignal;
  } | null,
  alerts: { alert_type: AlertType; severity: string }[],
  finalAction: FinalAction,
  fr = true,
): SocialOverlay {
  if (!subnetScore) {
    return {
      hasSocialData: false,
      socialConviction: 0,
      socialHeat: 0,
      pumpRisk: 0,
      smartKolScore: 0,
      narrativeStrength: 0,
      finalSignal: "none",
      badges: [],
      conflictMessage: null,
      reinforcementMessage: null,
    };
  }

  const badges: SocialBadge[] = [];

  // Generate badges from alerts
  for (const alert of alerts) {
    switch (alert.alert_type) {
      case "kol_call":
        badges.push({ type: "KOL_CALL", label: "KOL CALL", labelEn: "KOL CALL", severity: alert.severity as any });
        break;
      case "multi_account_buzz":
        badges.push({ type: "BUZZ", label: "BUZZ", labelEn: "BUZZ", severity: alert.severity as any });
        break;
      case "pump_risk":
        badges.push({ type: "PUMP_RISK", label: "RISQUE PUMP", labelEn: "PUMP RISK", severity: alert.severity as any });
        break;
      case "builder_update":
        badges.push({ type: "BUILDER_UPDATE", label: "MAJ BUILDER", labelEn: "BUILDER UPDATE", severity: "info" });
        break;
      case "official_mention":
        badges.push({ type: "OFFICIAL_SIGNAL", label: "SIGNAL OFFICIEL", labelEn: "OFFICIAL SIGNAL", severity: alert.severity as any });
        break;
      case "fund_signal":
        badges.push({ type: "FUND_SIGNAL", label: "SIGNAL FONDS", labelEn: "FUND SIGNAL", severity: alert.severity as any });
        break;
      case "bearish_warning":
        badges.push({ type: "BEARISH_WARNING", label: "ALERTE BEARISH", labelEn: "BEARISH WARNING", severity: alert.severity as any });
        break;
    }
  }

  // Compute conflict / reinforcement messages
  let conflictMessage: string | null = null;
  let reinforcementMessage: string | null = null;

  const signal = subnetScore.finalSignal;
  const conviction = subnetScore.socialConviction;
  const pumpRisk = subnetScore.pumpRisk;

  // RULE: social NEVER overrides SORTIR or ÉVITER
  if ((finalAction === "SORTIR" || finalAction === "ÉVITER") && (signal === "bullish" || signal === "positive" || conviction >= 60)) {
    conflictMessage = fr
      ? "Opportunité sociale détectée mais bloquée par garde-fous structurels"
      : "Social opportunity detected but blocked by structural safeguards";
  }

  // Social reinforces ENTER
  if (finalAction === "ENTRER" && conviction >= 60) {
    reinforcementMessage = fr
      ? "Signal KOL confirmé par plusieurs comptes — confiance narrative renforcée"
      : "KOL signal confirmed by multiple accounts — narrative confidence reinforced";
  }

  // Social reinforces SURVEILLER
  if (finalAction === "SURVEILLER" && conviction >= 50) {
    reinforcementMessage = fr
      ? "Narratif social fort — SURVEILLER renforcé, structure à confirmer"
      : "Strong social narrative — enhanced MONITOR, structure to confirm";
  }

  // Pump risk warning
  if (pumpRisk >= 50) {
    conflictMessage = fr
      ? "Risque d'emballement narratif — mentions concentrées sur petits comptes"
      : "Narrative pump risk — mentions concentrated on small accounts";
  }

  // Contradiction: social bullish but structural risk high
  if (signal === "bullish" && finalAction === "SORTIR") {
    conflictMessage = fr
      ? "Conflit : narratif fort mais structure fragile — garde-fous actifs"
      : "Conflict: strong narrative but fragile structure — safeguards active";
  }

  return {
    hasSocialData: true,
    socialConviction: conviction,
    socialHeat: subnetScore.socialHeat,
    pumpRisk,
    smartKolScore: subnetScore.smartKolScore,
    narrativeStrength: subnetScore.narrativeStrength,
    finalSignal: signal,
    badges,
    conflictMessage,
    reinforcementMessage,
  };
}

/* ── Badge Colors ── */

export function socialBadgeColor(type: SocialBadge["type"]): string {
  switch (type) {
    case "KOL_CALL": return "hsl(var(--signal-go))";
    case "BUZZ": return "hsl(var(--gold))";
    case "PUMP_RISK": return "hsl(var(--signal-break))";
    case "BEARISH_WARNING": return "hsl(var(--signal-break))";
    case "FUND_SIGNAL": return "hsl(var(--signal-go))";
    case "OFFICIAL_SIGNAL": return "hsl(var(--gold))";
    case "BUILDER_UPDATE": return "hsl(var(--muted-foreground))";
  }
}

/* ── Alert Severity Icon ── */

export function alertSeverityIcon(severity: string): string {
  switch (severity) {
    case "high": return "🔴";
    case "watch": return "🟡";
    default: return "🔵";
  }
}

/* ── Social Source Validation ── */

/** Returns true only for a real X/Twitter status URL */
export function isValidSocialSourceUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  try {
    const u = new URL(url);
    if (u.hostname !== "x.com" && u.hostname !== "twitter.com" && !u.hostname.endsWith(".x.com") && !u.hostname.endsWith(".twitter.com")) return false;
    if (!u.pathname.includes("/status/")) return false;
    const statusPart = u.pathname.split("/status/")[1]?.split(/[/?#]/)[0] ?? "";
    if (!statusPart) return false;
    return true;
  } catch {
    return false;
  }
}

export type SocialSourceState = "valid" | "missing";

/** Determine the source state for a social item */
export function getSocialSourceState(item: { url?: string | null }): SocialSourceState {
  if (!item.url) return "missing";
  if (isValidSocialSourceUrl(item.url)) return "valid";
  return "missing";
}

/** Human-readable label for the source link */
export function getSocialSourceLabel(item: { url?: string | null }, fr = true): string {
  const state = getSocialSourceState(item);
  switch (state) {
    case "valid": return fr ? "Voir sur X" : "View on X";
    case "missing": return fr ? "Source non disponible" : "Source unavailable";
  }
}
