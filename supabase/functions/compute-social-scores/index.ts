import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/* ── Scoring constants ── */
const TIER_WEIGHT: Record<string, number> = { A: 1.0, B: 0.8, C: 0.65 };
const POST_TYPE_WEIGHT: Record<string, number> = { original: 1.0, quote: 0.8, reply: 0.55, repost: 0.35 };
const SELF_MENTION_PENALTY = 0.35;
const STALE_HOURS = 168; // 7 days max window

function freshnessWeight(postedAt: string): number {
  const h = (Date.now() - new Date(postedAt).getTime()) / 3.6e6;
  if (h < 6) return 1.0;
  if (h < 24) return 0.85;
  if (h < 72) return 0.6;
  if (h < 168) return 0.35;
  return 0.1;
}

/**
 * 6-level social signal scale:
 * BULLISH / POSITIVE / NEUTRAL / CAUTION / PUMP_RISK / BEARISH
 */
function classifySignal(conviction: number, smartKol: number, pumpRisk: number, heat: number, rawCount: number, bearishRatio: number): string {
  // Pump risk takes precedence
  if (pumpRisk >= 45) return "pump_risk";
  // Bearish: strong negative sentiment
  if (conviction <= 25 && rawCount >= 3) return "bearish";
  if (conviction <= 35 && bearishRatio > 0.5) return "bearish";
  // Caution: mixed or slightly negative signals
  if (conviction <= 40 && rawCount >= 2) return "caution";
  if (pumpRisk >= 30 && conviction < 55) return "caution";
  // Bullish: strong conviction + smart KOL backing
  if (conviction >= 72 && smartKol >= 40 && rawCount >= 2) return "bullish";
  // Positive: good conviction but less KOL backing
  if (conviction >= 60 && rawCount >= 2) return "positive";
  if (conviction >= 55 && smartKol >= 30) return "positive";
  // Neutral: everything else
  return "neutral";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  try {
    // 1. Load mentions with post + account data (last 7 days)
    const cutoff = new Date(Date.now() - STALE_HOURS * 3.6e6).toISOString();

    const { data: mentions, error: mErr } = await supabase
      .from("social_post_mentions")
      .select(`
        subnet_uid, subnet_name, sentiment, self_mention, confidence_extraction, conviction_level,
        social_posts!inner(
          id, posted_at, post_type, engagement_score,
          social_accounts!inner(
            id, handle, tier, category, influence_weight, credibility_score
          )
        )
      `)
      .gte("social_posts.posted_at", cutoff);

    if (mErr) throw new Error(`Mentions query: ${mErr.message}`);
    if (!mentions?.length) {
      return new Response(
        JSON.stringify({ ok: true, message: "No mentions in window", scores: 0 }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // 2. Aggregate per subnet
    const subnets = new Map<number, {
      name: string | null;
      mentions: typeof mentions;
    }>();

    for (const m of mentions as any[]) {
      const uid = m.subnet_uid;
      if (!subnets.has(uid)) subnets.set(uid, { name: m.subnet_name, mentions: [] });
      subnets.get(uid)!.mentions.push(m);
    }

    // 3. Compute scores per subnet — with REAL DISPERSION
    const today = new Date().toISOString().split("T")[0];
    const scoreRows: any[] = [];

    for (const [uid, { name, mentions: ms }] of subnets) {
      const uniqueAccounts = new Set<string>();
      const uniquePosts = new Set<string>();
      let weightedBullish = 0;
      let weightedBearish = 0;
      let weightedNeutral = 0;
      let totalWeight = 0;
      let smartKolWeighted = 0;
      let smartKolCount = 0;
      let selfMentionCount = 0;
      let highTierCount = 0;
      let lowTierCount = 0;
      let tierAWeight = 0;
      let tierBWeight = 0;
      let tierCWeight = 0;
      let engagementTotal = 0;

      for (const m of ms as any[]) {
        const post = m.social_posts;
        const acct = post.social_accounts;

        uniqueAccounts.add(acct.id);
        uniquePosts.add(post.id);

        const tierW = TIER_WEIGHT[acct.tier] || 0.5;
        const postW = POST_TYPE_WEIGHT[post.post_type] || 0.5;
        const fresh = freshnessWeight(post.posted_at);
        const selfPenalty = m.self_mention ? (1 - SELF_MENTION_PENALTY) : 1;

        const weight = acct.influence_weight * acct.credibility_score * tierW * postW * fresh * m.confidence_extraction * selfPenalty;
        totalWeight += weight;

        if (m.sentiment === "bullish") weightedBullish += weight;
        else if (m.sentiment === "bearish") weightedBearish += weight;
        else weightedNeutral += weight;

        // Tier weight tracking
        if (acct.tier === "A") tierAWeight += weight;
        else if (acct.tier === "B") tierBWeight += weight;
        else tierCWeight += weight;

        engagementTotal += post.engagement_score || 0;

        // Smart KOL: only high-tier non-self accounts
        if ((acct.tier === "A" || acct.tier === "B") && !m.self_mention && acct.credibility_score >= 0.5) {
          smartKolWeighted += weight;
          smartKolCount++;
        }

        if (m.self_mention) selfMentionCount++;
        if (acct.tier === "A" || acct.tier === "B") highTierCount++;
        else lowTierCount++;
      }

      const rawCount = ms.length;
      const uniqueCount = uniqueAccounts.size;
      const postCount = uniquePosts.size;

      // ── CONVICTION: Non-linear, avoids flat 50 ──
      // Use directional strength + engagement + diversity
      const netSignal = totalWeight > 0 ? (weightedBullish - weightedBearish) / totalWeight : 0;
      const signalStrength = totalWeight > 0 ? (weightedBullish + weightedBearish) / totalWeight : 0;
      
      // Base from net signal (amplified non-linearly)
      let convictionBase = 50 + netSignal * 45;
      
      // Diversity bonus: more unique accounts = stronger signal
      if (uniqueCount >= 4) convictionBase += netSignal > 0 ? 8 : -8;
      else if (uniqueCount >= 2) convictionBase += netSignal > 0 ? 4 : -4;
      
      // Engagement amplifier: high engagement reinforces direction
      if (engagementTotal > 50) convictionBase += netSignal > 0 ? 5 : -5;
      
      // Smart KOL amplifier
      if (smartKolCount >= 2) convictionBase += netSignal > 0 ? 7 : -3;
      else if (smartKolCount === 1) convictionBase += netSignal > 0 ? 3 : -1;
      
      // Self-mention dampener: too many self-mentions = less conviction
      const selfRatio = rawCount > 0 ? selfMentionCount / rawCount : 0;
      if (selfRatio > 0.5) convictionBase = 50 + (convictionBase - 50) * 0.5;
      
      // Pure neutral mentions should NOT stay at 50 — slight regression toward "no signal"
      if (signalStrength < 0.1 && rawCount <= 2) {
        convictionBase = 45 + (convictionBase - 45) * 0.3;
      }
      
      const conviction = Math.round(Math.max(0, Math.min(100, convictionBase)));

      // ── HEAT: Non-linear volume-based with engagement ──
      const volumeScore = Math.min(60, rawCount * 6 + uniqueCount * 10);
      const engagementBonus = Math.min(25, Math.sqrt(engagementTotal) * 3);
      const freshnessBonus = ms.some((m: any) => {
        const h = (Date.now() - new Date(m.social_posts.posted_at).getTime()) / 3.6e6;
        return h < 6;
      }) ? 15 : 0;
      const heat = Math.round(Math.min(100, volumeScore + engagementBonus + freshnessBonus));

      // ── PUMP RISK: concentration + low-tier dominance ──
      const lowTierRatio = rawCount > 0 ? lowTierCount / rawCount : 0;
      const concentrationRatio = uniqueCount > 0 ? rawCount / uniqueCount : 0;
      let pumpRiskRaw = 0;
      pumpRiskRaw += lowTierRatio * 35;
      pumpRiskRaw += concentrationRatio > 3 ? 25 : concentrationRatio > 2 ? 12 : 0;
      pumpRiskRaw += selfRatio > 0.5 ? 20 : selfRatio > 0.3 ? 10 : 0;
      // Extreme bullish with no KOL backing = pump risk
      if (conviction > 70 && smartKolCount === 0 && uniqueCount <= 2) pumpRiskRaw += 15;
      const pumpRisk = Math.round(Math.min(100, pumpRiskRaw));

      // ── SMART KOL: quality of high-tier coverage ──
      let smartKol = 0;
      if (smartKolCount > 0 && totalWeight > 0) {
        const kolRatio = smartKolWeighted / totalWeight;
        smartKol = Math.round(Math.min(100,
          kolRatio * 70 + Math.min(30, smartKolCount * 12)
        ));
      }

      // ── NARRATIVE STRENGTH: diversity × conviction × freshness ──
      let narrativeRaw = 0;
      narrativeRaw += Math.min(35, uniqueCount * 10);
      narrativeRaw += conviction > 65 ? 20 : conviction > 55 ? 10 : conviction < 40 ? -5 : 0;
      narrativeRaw += smartKol > 40 ? 18 : smartKol > 20 ? 8 : 0;
      narrativeRaw += heat > 50 ? 12 : heat > 25 ? 5 : 0;
      narrativeRaw += postCount > 3 ? 10 : 0;
      const narrativeStrength = Math.round(Math.max(0, Math.min(100, narrativeRaw)));

      // ── BEARISH RATIO for signal classification ──
      const bearishRatio = totalWeight > 0 ? weightedBearish / totalWeight : 0;

      // ── FINAL SIGNAL: 6-level scale ──
      const finalSignal = classifySignal(conviction, smartKol, pumpRisk, heat, rawCount, bearishRatio);

      scoreRows.push({
        subnet_uid: uid,
        score_date: today,
        raw_mention_count: rawCount,
        unique_account_count: uniqueCount,
        weighted_bullish_score: Math.round(weightedBullish * 100) / 100,
        weighted_bearish_score: Math.round(weightedBearish * 100) / 100,
        social_conviction_score: conviction,
        social_heat_score: heat,
        pump_risk_score: pumpRisk,
        smart_kol_score: smartKol,
        narrative_strength: narrativeStrength,
        final_social_signal: finalSignal,
      });
    }

    // 4. Delete today's existing scores and insert fresh ones
    await supabase
      .from("social_subnet_scores")
      .delete()
      .eq("score_date", today);

    const { error: insErr } = await supabase
      .from("social_subnet_scores")
      .insert(scoreRows);

    if (insErr) throw new Error(`Insert scores: ${insErr.message}`);

    console.log(`compute-social-scores: ${scoreRows.length} subnets scored`);

    return new Response(
      JSON.stringify({
        ok: true,
        subnets_scored: scoreRows.length,
        total_mentions: mentions.length,
        score_date: today,
        synced_at: new Date().toISOString(),
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("compute-social-scores error:", e);
    return new Response(
      JSON.stringify({ error: (e as Error).message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
