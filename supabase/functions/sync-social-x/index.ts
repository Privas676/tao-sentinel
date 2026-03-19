import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const X_API = "https://api.x.com/2";

/* ── Subnet mention detection ── */

const SUBNET_PATTERNS = [
  /\bSN[-\s]?(\d{1,3})\b/gi,
  /\bsubnet\s*(\d{1,3})\b/gi,
  /\b#SN(\d{1,3})\b/gi,
];

const BULLISH_KW = /\b(bullish|moon|explode|accumulating|crushing|strong|milestone|breakthrough|100x|buy|long)\b/i;
const BEARISH_KW = /\b(bearish|warning|risk|danger|concentrated|sell|dump|exit|short|careful|avoid)\b/i;

function detectMentions(
  text: string,
  knownNames: Record<number, string>,
): { netuid: number; type: "direct_uid" | "direct_name" }[] {
  const found = new Map<number, "direct_uid" | "direct_name">();

  for (const pattern of SUBNET_PATTERNS) {
    const re = new RegExp(pattern.source, pattern.flags);
    let match;
    while ((match = re.exec(text)) !== null) {
      const uid = parseInt(match[1], 10);
      if (uid >= 0 && uid <= 255) found.set(uid, "direct_uid");
    }
  }

  const lower = text.toLowerCase();
  for (const [uidStr, name] of Object.entries(knownNames)) {
    if (name && name.length >= 3 && lower.includes(name.toLowerCase())) {
      const n = parseInt(uidStr, 10);
      if (!found.has(n)) found.set(n, "direct_name");
    }
  }

  return Array.from(found.entries()).map(([netuid, type]) => ({ netuid, type }));
}

function analyzeSentiment(text: string): "bullish" | "bearish" | "neutral" {
  const b = BULLISH_KW.test(text) ? 1 : 0;
  const br = BEARISH_KW.test(text) ? 1 : 0;
  if (b > br) return "bullish";
  if (br > b) return "bearish";
  return "neutral";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const BEARER = Deno.env.get("X_BEARER_TOKEN");
  if (!BEARER) {
    return new Response(
      JSON.stringify({ error: "X_BEARER_TOKEN not configured" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  try {
    // 1. Get active accounts + subnet names in parallel
    const [acctRes, subnetRes] = await Promise.all([
      supabase
        .from("social_accounts")
        .select("id, handle, tier, category, influence_weight, credibility_score")
        .eq("is_active", true)
        .eq("platform", "x")
        .order("influence_weight", { ascending: false }),
      supabase
        .from("subnets")
        .select("netuid, name"),
    ]);

    if (acctRes.error) throw new Error(`Accounts fetch: ${acctRes.error.message}`);
    const accounts = acctRes.data || [];
    if (!accounts.length) {
      return new Response(
        JSON.stringify({ ok: true, message: "No active X accounts", posts: 0 }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Build netuid → name map
    const knownNames: Record<number, string> = {};
    for (const s of subnetRes.data || []) {
      if (s.name && s.name !== "Unknown") knownNames[s.netuid] = s.name;
    }

    let totalInserted = 0;
    let totalSkipped = 0;
    let totalMentions = 0;
    const errors: string[] = [];

    // 2. For each account, fetch recent tweets
    for (const acct of accounts) {
      try {
        const query = `from:${acct.handle} -is:retweet`;
        const params = new URLSearchParams({
          query,
          max_results: "10",
          "tweet.fields": "created_at,public_metrics,referenced_tweets",
          expansions: "author_id",
          "user.fields": "username,name",
        });

        const res = await fetch(`${X_API}/tweets/search/recent?${params}`, {
          headers: { Authorization: `Bearer ${BEARER}` },
        });

        if (!res.ok) {
          const body = await res.text();
          if (res.status === 429) {
            console.warn(`Rate limited on @${acct.handle}, skipping`);
            errors.push(`@${acct.handle}: 429 rate limited`);
            continue;
          }
          errors.push(`@${acct.handle}: ${res.status} ${body.slice(0, 200)}`);
          continue;
        }

        const json = await res.json();
        const tweets = json.data || [];

        for (const tweet of tweets) {
          const tweetId = tweet.id;
          const postUrl = `https://x.com/${acct.handle}/status/${tweetId}`;
          const postedAt = tweet.created_at;
          const metrics = tweet.public_metrics || {};

          let postType = "original";
          if (tweet.referenced_tweets?.length) {
            const refType = tweet.referenced_tweets[0].type;
            if (refType === "quoted") postType = "quote";
            else if (refType === "replied_to") postType = "reply";
          }

          // Check if already exists
          const { data: existing } = await supabase
            .from("social_posts")
            .select("id")
            .eq("external_post_id", tweetId)
            .maybeSingle();

          if (existing) {
            totalSkipped++;
            continue;
          }

          // Insert post
          const { data: inserted, error: insErr } = await supabase
            .from("social_posts")
            .insert({
              account_id: acct.id,
              external_post_id: tweetId,
              url: postUrl,
              posted_at: postedAt,
              raw_text: tweet.text,
              clean_text: tweet.text,
              post_type: postType,
              like_count: metrics.like_count || 0,
              reply_count: metrics.reply_count || 0,
              repost_count: metrics.retweet_count || 0,
              view_count: metrics.impression_count || 0,
              engagement_score: computeEngagement(metrics),
              language: "en",
            })
            .select("id")
            .single();

          if (insErr) {
            errors.push(`Insert @${acct.handle}/${tweetId}: ${insErr.message}`);
            continue;
          }

          totalInserted++;

          // 3. Detect subnet mentions in tweet text
          const text = tweet.text || "";
          const mentions = detectMentions(text, knownNames);
          if (mentions.length > 0 && inserted) {
            const sentiment = analyzeSentiment(text);
            const isSelfMention = acct.category === "builder";

            const mentionRows = mentions.map((m) => ({
              post_id: inserted.id,
              subnet_uid: m.netuid,
              subnet_name: knownNames[m.netuid] || null,
              mention_type: m.type,
              sentiment,
              conviction_level: sentiment === "neutral" ? 0 : sentiment === "bullish" ? 60 : -40,
              self_mention: isSelfMention,
              confidence_extraction: m.type === "direct_uid" ? 0.95 : 0.75,
            }));

            const { error: mentErr } = await supabase
              .from("social_post_mentions")
              .insert(mentionRows);

            if (mentErr) {
              errors.push(`Mentions @${acct.handle}/${tweetId}: ${mentErr.message}`);
            } else {
              totalMentions += mentions.length;
            }
          }
        }

        // Small delay between accounts to respect rate limits
        await new Promise((r) => setTimeout(r, 1000));
      } catch (e) {
        errors.push(`@${acct.handle}: ${(e as Error).message}`);
      }
    }

    const result = {
      ok: true,
      accounts_processed: accounts.length,
      posts_inserted: totalInserted,
      posts_skipped: totalSkipped,
      mentions_created: totalMentions,
      errors: errors.length > 0 ? errors : undefined,
      synced_at: new Date().toISOString(),
    };

    console.log(
      `sync-social-x: ${totalInserted} new, ${totalSkipped} skipped, ${totalMentions} mentions, ${errors.length} errors`,
    );

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("sync-social-x error:", e);
    return new Response(
      JSON.stringify({ error: (e as Error).message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});

function computeEngagement(m: {
  like_count?: number;
  reply_count?: number;
  retweet_count?: number;
  impression_count?: number;
}): number {
  const interactions =
    (m.like_count || 0) + (m.reply_count || 0) * 2 + (m.retweet_count || 0) * 3;
  const views = m.impression_count || 1;
  return Math.min(100, Math.round((interactions / views) * 1000));
}
