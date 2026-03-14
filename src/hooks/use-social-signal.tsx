import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/* ── Types ── */

export type SocialAccount = {
  id: string;
  handle: string;
  display_name: string | null;
  platform: string;
  category: string;
  tier: string;
  influence_weight: number;
  credibility_score: number;
  accuracy_history: number;
  false_positive_rate: number;
  is_active: boolean;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export type SocialPost = {
  id: string;
  account_id: string;
  external_post_id: string | null;
  posted_at: string;
  raw_text: string | null;
  clean_text: string | null;
  language: string | null;
  post_type: string;
  url: string | null;
  like_count: number;
  reply_count: number;
  repost_count: number;
  view_count: number;
  engagement_score: number;
  created_at: string;
  // joined
  account?: SocialAccount;
  mentions?: SocialPostMention[];
};

export type SocialPostMention = {
  id: string;
  post_id: string;
  subnet_uid: number;
  subnet_name: string | null;
  mention_type: string;
  sentiment: string;
  conviction_level: number;
  self_mention: boolean;
  confidence_extraction: number;
  created_at: string;
};

export type SocialSubnetScore = {
  id: string;
  subnet_uid: number;
  score_date: string;
  raw_mention_count: number;
  unique_account_count: number;
  weighted_bullish_score: number;
  weighted_bearish_score: number;
  social_conviction_score: number;
  social_heat_score: number;
  pump_risk_score: number;
  smart_kol_score: number;
  narrative_strength: number;
  final_social_signal: string;
  created_at: string;
};

export type SocialAlert = {
  id: string;
  subnet_uid: number;
  alert_type: string;
  title: string;
  description: string | null;
  severity: string;
  source_count: number;
  weighted_score: number;
  is_active: boolean;
  created_at: string;
};

/* ── Hooks ── */

const T = (table: string) => table as any;

export function useSocialAccounts() {
  return useQuery({
    queryKey: ["social_accounts"],
    queryFn: async () => {
      const { data, error } = await supabase.from(T("social_accounts")).select("*").order("influence_weight", { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as SocialAccount[];
    },
  });
}

export function useToggleAccount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, is_active }: { id: string; is_active: boolean }) => {
      const { error } = await supabase.from(T("social_accounts")).update({ is_active, updated_at: new Date().toISOString() } as any).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["social_accounts"] }),
  });
}

export function useDeleteAccount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from(T("social_accounts")).delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["social_accounts"] }),
  });
}

export function useAddAccount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (acct: { handle: string; display_name: string; tier: string; influence_weight: number; category: string; credibility_score: number }) => {
      const { error } = await supabase.from(T("social_accounts")).insert(acct as any);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["social_accounts"] }),
  });
}

export function useSocialPosts() {
  return useQuery({
    queryKey: ["social_posts"],
    queryFn: async () => {
      const { data, error } = await supabase.from(T("social_posts")).select("*, social_accounts!inner(handle, display_name, category, tier, influence_weight)").order("posted_at", { ascending: false }).limit(50);
      if (error) throw error;
      return (data ?? []).map((p: any) => ({
        ...p,
        account: p.social_accounts,
      })) as unknown as SocialPost[];
    },
  });
}

export function useSocialPostMentions(postIds?: string[]) {
  return useQuery({
    queryKey: ["social_post_mentions", postIds],
    enabled: !!postIds?.length,
    queryFn: async () => {
      const { data, error } = await supabase.from(T("social_post_mentions")).select("*").in("post_id", postIds!);
      if (error) throw error;
      return (data ?? []) as unknown as SocialPostMention[];
    },
  });
}

export function useSocialSubnetScores() {
  return useQuery({
    queryKey: ["social_subnet_scores"],
    queryFn: async () => {
      const { data, error } = await supabase.from(T("social_subnet_scores")).select("*").eq("score_date", new Date().toISOString().split("T")[0]).order("social_conviction_score", { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as SocialSubnetScore[];
    },
  });
}

export function useSocialAlerts() {
  return useQuery({
    queryKey: ["social_alerts"],
    queryFn: async () => {
      const { data, error } = await supabase.from(T("social_alerts")).select("*").eq("is_active", true).order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as SocialAlert[];
    },
  });
}

export function useSocialSubnetData(subnetUid?: number) {
  const scores = useSocialSubnetScores();
  const alerts = useSocialAlerts();

  const subnetScore = scores.data?.find(s => s.subnet_uid === subnetUid) ?? null;
  const subnetAlerts = alerts.data?.filter(a => a.subnet_uid === subnetUid) ?? [];

  return {
    score: subnetScore,
    alerts: subnetAlerts,
    isLoading: scores.isLoading || alerts.isLoading,
  };
}
