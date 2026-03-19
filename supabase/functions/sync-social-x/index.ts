import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const X_API = "https://api.x.com/2";

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
    // 1. Get active accounts from watchlist
    const { data: accounts, error: accErr } = await supabase
      .from("social_accounts")
      .select("id, handle, tier, category, influence_weight, credibility_score")
      .eq("is_active", true)
      .eq("platform", "x")
      .order("influence_weight", { ascending: false });

    if (accErr) throw new Error(`Accounts fetch: ${accErr.message}`);
    if (!accounts?.length) {
      return new Response(
        JSON.stringify({ ok: true, message: "No active X accounts", posts: 0 }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    let totalInserted = 0;
    let totalSkipped = 0;
    const errors: string[] = [];

    // 2. For each account, fetch recent tweets
    for (const acct of accounts) {
      try {
        // Search recent tweets from this user
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

          // Determine post_type
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
          const { error: insErr } = await supabase.from("social_posts").insert({
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
          });

          if (insErr) {
            errors.push(`Insert @${acct.handle}/${tweetId}: ${insErr.message}`);
          } else {
            totalInserted++;
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
      errors: errors.length > 0 ? errors : undefined,
      synced_at: new Date().toISOString(),
    };

    console.log(`sync-social-x: ${totalInserted} new, ${totalSkipped} skipped, ${errors.length} errors`);

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
  const interactions = (m.like_count || 0) + (m.reply_count || 0) * 2 + (m.retweet_count || 0) * 3;
  const views = m.impression_count || 1;
  return Math.min(100, Math.round((interactions / views) * 1000));
}
