import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type SocialKol = {
  id: number;
  handle: string;
  display_name: string | null;
  tier: string;
  influence_weight: number;
  category: string;
  is_active: boolean;
  self_mention: boolean;
  credibility_score: number | null;
  accuracy_history: any;
  false_positive_rate: number | null;
  last_seen_at: string | null;
  created_at: string;
  updated_at: string;
};

export function useSocialKols() {
  return useQuery({
    queryKey: ["social_kols"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("social_kols" as any)
        .select("*")
        .order("influence_weight", { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as SocialKol[];
    },
  });
}

export function useToggleKol() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, is_active }: { id: number; is_active: boolean }) => {
      const { error } = await supabase
        .from("social_kols" as any)
        .update({ is_active, updated_at: new Date().toISOString() } as any)
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["social_kols"] }),
  });
}

export function useDeleteKol() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: number) => {
      const { error } = await supabase
        .from("social_kols" as any)
        .delete()
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["social_kols"] }),
  });
}

export function useAddKol() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (kol: { handle: string; display_name: string; tier: string; influence_weight: number; category: string }) => {
      const { error } = await supabase
        .from("social_kols" as any)
        .insert(kol as any);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["social_kols"] }),
  });
}
