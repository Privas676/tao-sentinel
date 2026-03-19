import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUBNET_PATTERNS = [
  /\bSN[-\s]?(\d{1,3})\b/gi,
  /\bsubnet\s*(\d{1,3})\b/gi,
  /\b#SN(\d{1,3})\b/gi,
];
const BULLISH_KW = /\b(bullish|moon|explode|accumulating|crushing|strong|milestone|breakthrough|100x|buy|long)\b/i;
const BEARISH_KW = /\b(bearish|warning|risk|danger|concentrated|sell|dump|exit|short|careful|avoid)\b/i;

function detectMentions(text: string, knownNames: Record<number, string>) {
  const found = new Map<number, "direct_uid" | "direct_name">();
  for (const p of SUBNET_PATTERNS) {
    const re = new RegExp(p.source, p.flags);
    let m;
    while ((m = re.exec(text)) !== null) {
      const uid = parseInt(m[1], 10);
      if (uid >= 0 && uid <= 255) found.set(uid, "direct_uid");
    }
  }
  const lower = text.toLowerCase();
  for (const [u, name] of Object.entries(knownNames)) {
    if (name && name.length >= 3 && lower.includes(name.toLowerCase())) {
      const n = parseInt(u, 10);
      if (!found.has(n)) found.set(n, "direct_name");
    }
  }
  return Array.from(found.entries()).map(([netuid, type]) => ({ netuid, type }));
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  // Load subnets + all posts without mentions
  const [subRes, postRes] = await Promise.all([
    supabase.from("subnets").select("netuid, name"),
    supabase.from("social_posts").select("id, raw_text, account_id, social_accounts!inner(category)").order("posted_at", { ascending: false }).limit(500),
  ]);

  const knownNames: Record<number, string> = {};
  for (const s of subRes.data || []) if (s.name && s.name !== "Unknown") knownNames[s.netuid] = s.name;

  // Check which posts already have mentions
  const postIds = (postRes.data || []).map((p: any) => p.id);
  const { data: existingMentions } = await supabase.from("social_post_mentions").select("post_id").in("post_id", postIds);
  const hasM = new Set((existingMentions || []).map((m: any) => m.post_id));

  let created = 0;
  for (const post of postRes.data || []) {
    if (hasM.has(post.id)) continue;
    const text = post.raw_text || "";
    const mentions = detectMentions(text, knownNames);
    if (!mentions.length) continue;

    const sentiment = BULLISH_KW.test(text) ? "bullish" : BEARISH_KW.test(text) ? "bearish" : "neutral";
    const isSelf = (post as any).social_accounts?.category === "builder";

    const rows = mentions.map(m => ({
      post_id: post.id,
      subnet_uid: m.netuid,
      subnet_name: knownNames[m.netuid] || null,
      mention_type: m.type,
      sentiment,
      conviction_level: sentiment === "neutral" ? 0 : sentiment === "bullish" ? 60 : -40,
      self_mention: isSelf,
      confidence_extraction: m.type === "direct_uid" ? 0.95 : 0.75,
    }));

    const { error } = await supabase.from("social_post_mentions").insert(rows);
    if (!error) created += rows.length;
  }

  return new Response(JSON.stringify({ ok: true, mentions_created: created, posts_checked: postIds.length }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
