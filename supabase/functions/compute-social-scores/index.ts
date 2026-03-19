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
        subnet_uid, subnet_name, sentiment, self_mention, confidence_extraction,
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

    // 3. Compute scores per subnet
    const today = new Date().toISOString().split("T")[0];
    const scoreRows: any[] = [];

    for (const [uid, { name, mentions: ms }] of subnets) {
      const uniqueAccounts = new Set<string>();
      let weightedBullish = 0;
      let weightedBearish = 0;
      let totalWeight = 0;
      let smartKolWeighted = 0;
      let smartKolCount = 0;
      let selfMentionCount = 0;
      let highTierCount = 0;
      let lowTierCount = 0;

      for (const m of ms as any[]) {
        const post = m.social_posts;
        const acct = post.social_accounts;

        uniqueAccounts.add(acct.id);

        const tierW = TIER_WEIGHT[acct.tier] || 0.5;
        const postW = POST_TYPE_WEIGHT[post.post_type] || 0.5;
        const fresh = freshnessWeight(post.posted_at);
        const selfPenalty = m.self_mention ? (1 - SELF_MENTION_PENALTY) : 1;

        const weight = acct.influence_weight * acct.credibility_score * tierW * postW * fresh * m.confidence_extraction * selfPenalty;
        totalWeight += weight;

        if (m.sentiment === "bullish") weightedBullish += weight;
        else if (m.sentiment === "bearish") weightedBearish += weight;

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

      // Conviction: net bullish-bearish weighted, normalized 0-100
      const netSignal = totalWeight > 0 ? (weightedBullish - weightedBearish) / totalWeight : 0;
      const conviction = Math.round(Math.max(0, Math.min(100, 50 + netSignal * 50)));

      // Heat: volume-based, more mentions = more heat
      const heat = Math.round(Math.min(100, rawCount * 8 + uniqueCount * 15));

      // Pump risk: high mentions from low-tier accounts, few unique sources
      const lowTierRatio = rawCount > 0 ? lowTierCount / rawCount : 0;
      const concentrationRatio = uniqueCount > 0 ? rawCount / uniqueCount : 0;
      const pumpRisk = Math.round(Math.min(100,
        lowTierRatio * 40 +
        (concentrationRatio > 3 ? 30 : concentrationRatio > 2 ? 15 : 0) +
        (selfMentionCount > rawCount * 0.5 ? 25 : 0)
      ));

      // Smart KOL score: quality of high-tier coverage
      const smartKol = Math.round(Math.min(100,
        smartKolCount > 0
          ? (smartKolWeighted / (totalWeight || 1)) * 80 + Math.min(20, smartKolCount * 10)
          : 0
      ));

      // Narrative strength: diversity × conviction
      const narrativeStrength = Math.round(Math.min(100,
        uniqueCount * 12 + (conviction > 60 ? 20 : 0) + (smartKol > 40 ? 15 : 0)
      ));

      // Final signal
      let finalSignal = "none";
      if (pumpRisk >= 50) finalSignal = "pump_risk";
      else if (conviction >= 65 && smartKol >= 30) finalSignal = "bullish";
      else if (conviction <= 35 && rawCount >= 3) finalSignal = "bearish";
      else if (rawCount >= 2) finalSignal = "watch";

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
