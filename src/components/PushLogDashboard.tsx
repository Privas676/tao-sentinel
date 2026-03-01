import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useI18n } from "@/lib/i18n";

type PushLogRow = {
  id: number;
  event_id: string;
  event_type: string;
  netuid: number | null;
  priority: number;
  status: string;
  endpoint: string;
  http_status: number | null;
  retry_count: number;
  error_message: string | null;
  created_at: string;
  sent_at: string | null;
  payload: any;
};

const PRIORITY_LABELS: Record<number, { label: string; color: string }> = {
  0: { label: "P0 DEPEG", color: "rgba(229,57,53,0.9)" },
  1: { label: "P1 OVERRIDE", color: "rgba(255,152,0,0.9)" },
  2: { label: "P2 SYSTEM", color: "rgba(255,193,7,0.9)" },
  3: { label: "P3 SIGNAL", color: "rgba(76,175,80,0.9)" },
};

const STATUS_STYLES: Record<string, { bg: string; color: string }> = {
  sent: { bg: "rgba(76,175,80,0.12)", color: "rgba(76,175,80,0.9)" },
  pending: { bg: "rgba(255,193,7,0.12)", color: "rgba(255,193,7,0.9)" },
  retry: { bg: "rgba(255,152,0,0.12)", color: "rgba(255,152,0,0.9)" },
  failed: { bg: "rgba(229,57,53,0.12)", color: "rgba(229,57,53,0.9)" },
  expired: { bg: "rgba(120,120,120,0.12)", color: "rgba(180,180,180,0.7)" },
};

export default function PushLogDashboard() {
  const { lang } = useI18n();
  const fr = lang === "fr";
  const [logs, setLogs] = useState<PushLogRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [stats, setStats] = useState({ sent: 0, failed: 0, retry: 0, expired: 0, total: 0 });

  const loadLogs = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from("push_log")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(50);

    const rows = (data || []) as PushLogRow[];
    setLogs(rows);

    const s = { sent: 0, failed: 0, retry: 0, expired: 0, total: rows.length };
    for (const r of rows) {
      if (r.status === "sent") s.sent++;
      else if (r.status === "failed") s.failed++;
      else if (r.status === "retry") s.retry++;
      else if (r.status === "expired") s.expired++;
    }
    setStats(s);
    setLoading(false);
  }, []);

  useEffect(() => { loadLogs(); }, [loadLogs]);

  const fmtTime = (ts: string | null) => {
    if (!ts) return "—";
    const d = new Date(ts);
    return d.toLocaleTimeString(fr ? "fr-FR" : "en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  };

  const fmtDate = (ts: string) => {
    const d = new Date(ts);
    return d.toLocaleDateString(fr ? "fr-FR" : "en-US", { day: "2-digit", month: "2-digit" });
  };

  const truncEndpoint = (ep: string) => {
    try {
      const u = new URL(ep);
      return `${u.hostname.slice(0, 20)}…`;
    } catch { return ep.slice(0, 25) + "…"; }
  };

  return (
    <div className="space-y-3">
      {/* Header + refresh */}
      <div className="flex items-center justify-between">
        <div className="flex gap-3">
          {[
            { label: fr ? "Envoyés" : "Sent", val: stats.sent, color: "rgba(76,175,80,0.8)" },
            { label: fr ? "Échecs" : "Failed", val: stats.failed, color: "rgba(229,57,53,0.8)" },
            { label: "Retry", val: stats.retry, color: "rgba(255,152,0,0.8)" },
            { label: fr ? "Expirés" : "Expired", val: stats.expired, color: "rgba(150,150,150,0.7)" },
          ].map(s => (
            <div key={s.label} className="text-center">
              <div className="font-mono text-base font-bold" style={{ color: s.color }}>{s.val}</div>
              <div className="font-mono text-[8px] text-white/30">{s.label}</div>
            </div>
          ))}
        </div>
        <button
          onClick={loadLogs}
          disabled={loading}
          className="font-mono text-[10px] px-3 py-1.5 rounded-lg transition-all"
          style={{
            background: "rgba(255,255,255,0.05)",
            color: "rgba(255,255,255,0.5)",
            border: "1px solid rgba(255,255,255,0.1)",
            opacity: loading ? 0.4 : 1,
          }}
        >
          {loading ? "…" : "↻"}
        </button>
      </div>

      {/* Log entries */}
      {logs.length === 0 && !loading && (
        <p className="font-mono text-[10px] text-white/20 text-center py-4">
          {fr ? "Aucun push envoyé." : "No push sent yet."}
        </p>
      )}

      <div className="space-y-1.5 max-h-[400px] overflow-y-auto pr-1">
        {logs.map(row => {
          const pri = PRIORITY_LABELS[row.priority] || PRIORITY_LABELS[3];
          const st = STATUS_STYLES[row.status] || STATUS_STYLES.pending;
          return (
            <details key={row.id} className="border border-white/[0.06] rounded-lg overflow-hidden group">
              <summary className="flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-white/[0.02] transition-colors">
                {/* Priority badge */}
                <span
                  className="font-mono text-[8px] px-1.5 py-0.5 rounded shrink-0"
                  style={{ color: pri.color, background: pri.color.replace("0.9", "0.1") }}
                >
                  {pri.label}
                </span>

                {/* Event type + subnet */}
                <span className="font-mono text-[10px] text-white/60 truncate flex-1">
                  {row.event_type}
                  {row.netuid != null && <span className="text-white/30 ml-1">SN-{row.netuid}</span>}
                </span>

                {/* Status badge */}
                <span
                  className="font-mono text-[8px] px-1.5 py-0.5 rounded shrink-0 uppercase"
                  style={{ background: st.bg, color: st.color }}
                >
                  {row.status}
                  {row.retry_count > 0 && ` (×${row.retry_count})`}
                </span>

                {/* Time */}
                <span className="font-mono text-[8px] text-white/25 shrink-0">
                  {fmtDate(row.created_at)} {fmtTime(row.created_at)}
                </span>
              </summary>

              {/* Detail */}
              <div className="px-3 pb-2 space-y-1 border-t border-white/[0.04]">
                <div className="grid grid-cols-2 gap-x-4 gap-y-1 mt-2">
                  <div className="font-mono text-[9px] text-white/30">Event ID</div>
                  <div className="font-mono text-[9px] text-white/50 truncate">{row.event_id}</div>

                  <div className="font-mono text-[9px] text-white/30">Endpoint</div>
                  <div className="font-mono text-[9px] text-white/50 truncate">{truncEndpoint(row.endpoint)}</div>

                  <div className="font-mono text-[9px] text-white/30">HTTP</div>
                  <div className="font-mono text-[9px] text-white/50">{row.http_status ?? "—"}</div>

                  {row.sent_at && (
                    <>
                      <div className="font-mono text-[9px] text-white/30">{fr ? "Envoyé à" : "Sent at"}</div>
                      <div className="font-mono text-[9px] text-white/50">{fmtTime(row.sent_at)}</div>
                    </>
                  )}

                  {row.error_message && (
                    <>
                      <div className="font-mono text-[9px] text-red-400/60">{fr ? "Erreur" : "Error"}</div>
                      <div className="font-mono text-[9px] text-red-400/80 truncate">{row.error_message}</div>
                    </>
                  )}
                </div>

                {row.payload && Object.keys(row.payload).length > 0 && (
                  <details className="mt-1">
                    <summary className="font-mono text-[8px] text-white/20 cursor-pointer">Payload</summary>
                    <pre className="font-mono text-[8px] text-white/20 mt-1 max-h-20 overflow-auto whitespace-pre-wrap">
                      {JSON.stringify(row.payload, null, 2)}
                    </pre>
                  </details>
                )}
              </div>
            </details>
          );
        })}
      </div>
    </div>
  );
}
