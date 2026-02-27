import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "./use-auth";

export type DbPosition = {
  id: string;
  user_id: string;
  netuid: number;
  capital: number;
  entry_price: number;
  quantity: number;
  stop_loss_pct: number;
  take_profit_pct: number;
  status: string;
  closed_at: string | null;
  closed_price: number | null;
  created_at: string;
  updated_at: string;
};

export function usePositions() {
  const { user } = useAuth();

  const query = useQuery({
    queryKey: ["positions", user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("positions")
        .select("*")
        .eq("status", "open")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data || []) as DbPosition[];
    },
    enabled: !!user,
    refetchInterval: 60_000,
  });

  return query;
}

export function useOpenPosition() {
  const qc = useQueryClient();
  const { user } = useAuth();

  return useMutation({
    mutationFn: async (params: {
      netuid: number;
      capital: number;
      entry_price: number;
      stop_loss_pct: number;
      take_profit_pct: number;
    }) => {
      if (!user) throw new Error("Not authenticated");
      const quantity = params.capital / params.entry_price;
      const { data, error } = await supabase
        .from("positions")
        .insert({
          user_id: user.id,
          netuid: params.netuid,
          capital: params.capital,
          entry_price: params.entry_price,
          quantity,
          stop_loss_pct: params.stop_loss_pct,
          take_profit_pct: params.take_profit_pct,
        })
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["positions"] }),
  });
}

export function useClosePosition() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async (params: { id: string; closed_price: number }) => {
      const { error } = await supabase
        .from("positions")
        .update({
          status: "closed",
          closed_at: new Date().toISOString(),
          closed_price: params.closed_price,
        })
        .eq("id", params.id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["positions"] }),
  });
}
