import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { SignalBadge } from "@/components/SignalBadge";
import { formatZurichTime } from "@/lib/formatters";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useState } from "react";
import {
  Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerDescription,
} from "@/components/ui/drawer";

const EVENT_FILTERS = ["ALL", "GO", "GO_SPECULATIVE", "HOLD", "EXIT_FAST"] as const;

export default function Alerts() {
  const [filter, setFilter] = useState<string>("ALL");
  const [selectedEvent, setSelectedEvent] = useState<any>(null);

  const { data: events, isLoading } = useQuery({
    queryKey: ["all-events", filter],
    queryFn: async () => {
      let q = supabase
        .from("events")
        .select("*")
        .order("ts", { ascending: false })
        .limit(200);
      if (filter !== "ALL") {
        q = q.eq("type", filter);
      }
      const { data, error } = await q;
      if (error) throw error;
      return data || [];
    },
    refetchInterval: 60000,
  });

  // Get subnet names
  const { data: subnets } = useQuery({
    queryKey: ["subnets-list"],
    queryFn: async () => {
      const { data } = await supabase.from("subnets").select("netuid, name");
      return new Map((data || []).map((s) => [s.netuid, s.name]));
    },
  });

  return (
    <div className="p-6 space-y-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Alerts</h1>
        <p className="text-sm text-muted-foreground">Signal events across all subnets</p>
      </div>

      <div className="flex gap-2">
        {EVENT_FILTERS.map((f) => (
          <Button
            key={f}
            variant={filter === f ? "default" : "outline"}
            size="sm"
            className="text-xs font-mono"
            onClick={() => setFilter(f)}
          >
            {f === "GO_SPECULATIVE" ? "SPEC" : f}
          </Button>
        ))}
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading events...</p>
      ) : (events || []).length === 0 ? (
        <p className="text-sm text-muted-foreground">No events yet. Waiting for signal engine...</p>
      ) : (
        <div className="space-y-2">
          {(events || []).map((ev) => {
            const name = subnets?.get(ev.netuid) || `SN-${ev.netuid}`;
            return (
              <Card
                key={ev.id}
                className="cursor-pointer hover:bg-accent/50 transition-colors"
                onClick={() => setSelectedEvent(ev)}
              >
                <CardContent className="p-4 flex items-center gap-4">
                  <SignalBadge state={ev.type} className="min-w-[80px] text-center" />
                  <span className="font-mono text-sm text-muted-foreground w-12">
                    SN-{ev.netuid}
                  </span>
                  <span className="text-sm font-medium">{name}</span>
                  <span className="text-xs text-muted-foreground ml-auto whitespace-nowrap">
                    {formatZurichTime(ev.ts)}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    Sev: {ev.severity}
                  </span>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <Drawer open={!!selectedEvent} onOpenChange={(o) => !o && setSelectedEvent(null)}>
        <DrawerContent>
          <DrawerHeader>
            <DrawerTitle className="flex items-center gap-3">
              <SignalBadge state={selectedEvent?.type} />
              SN-{selectedEvent?.netuid} — {formatZurichTime(selectedEvent?.ts)}
            </DrawerTitle>
            <DrawerDescription>Evidence details</DrawerDescription>
          </DrawerHeader>
          <div className="p-4 max-h-[50vh] overflow-auto">
            <pre className="text-xs font-mono text-muted-foreground bg-secondary p-4 rounded-md overflow-auto">
              {JSON.stringify(selectedEvent?.evidence, null, 2)}
            </pre>
          </div>
        </DrawerContent>
      </Drawer>
    </div>
  );
}
