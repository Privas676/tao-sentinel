import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useI18n } from "@/lib/i18n";
import { stateColor, deriveGaugeState } from "@/lib/gauge-engine";

type EventRow = {
  id: number;
  netuid: number | null;
  type: string | null;
  severity: number | null;
  ts: string | null;
  evidence: any;
};

export default function AlertsPage() {
  const { t } = useI18n();

  const { data: events } = useQuery({
    queryKey: ["events-log"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("events")
        .select("*")
        .order("ts", { ascending: false })
        .limit(100);
      if (error) throw error;
      return (data || []) as EventRow[];
    },
    refetchInterval: 60_000,
  });

  const severityColor = (sev: number | null) => {
    if (!sev || sev <= 1) return "rgba(84,110,122,0.7)";
    if (sev === 2) return "rgba(251,192,45,0.7)";
    if (sev === 3) return "rgba(255,109,0,0.8)";
    return "rgba(229,57,53,0.8)";
  };

  return (
    <div className="h-full w-full bg-[#000] text-white p-4 sm:p-6 overflow-auto pt-14">
      <h1 className="font-mono text-base sm:text-lg tracking-widest text-white/80 mb-4 sm:mb-6">{t("alerts.title")}</h1>

      {(!events || events.length === 0) ? (
        <div className="text-center text-white/20 font-mono mt-20">{t("alerts.empty")}</div>
      ) : (
        <div className="space-y-2">
          {events.map(ev => {
            const evidence = ev.evidence as any;
            const reasons = evidence?.reasons as string[] | undefined;
            const psi = evidence?.mpi ?? evidence?.psi ?? null;
            return (
              <div key={ev.id} className="flex flex-wrap sm:flex-nowrap items-start sm:items-center gap-2 sm:gap-4 px-3 sm:px-4 py-3 border border-white/[0.04] rounded-lg hover:bg-white/[0.02] transition-colors">
                {/* Severity dot */}
                <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: severityColor(ev.severity) }} />

                {/* Type */}
                <div className="font-mono text-xs tracking-wider min-w-[100px]" style={{ color: severityColor(ev.severity) }}>
                  {ev.type || "—"}
                </div>

                {/* Subnet */}
                <div className="font-mono text-xs text-white/50 min-w-[60px]">
                  SN-{ev.netuid}
                </div>

                {/* PSI if available */}
                {psi != null && (
                  <div className="font-mono text-xs text-white/40">PSI {psi}</div>
                )}

                {/* Reasons */}
                <div className="font-mono text-[10px] text-white/30 flex-1 truncate">
                  {reasons?.join(" · ") || "—"}
                </div>

                {/* Timestamp */}
                <div className="font-mono text-[10px] text-white/20 flex-shrink-0">
                  {ev.ts ? new Date(ev.ts).toLocaleString() : "—"}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
