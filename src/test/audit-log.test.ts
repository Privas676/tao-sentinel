import { describe, it, expect, vi } from "vitest";
import { auditToCsv, auditToJson } from "@/lib/audit-log";

// Mock supabase to avoid real calls
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => ({
      insert: () => Promise.resolve({ error: null }),
      select: () => ({
        gte: () => ({
          lte: () => ({
            order: () => ({
              limit: () => Promise.resolve({ data: [], error: null }),
              eq: () => ({
                limit: () => Promise.resolve({ data: [], error: null }),
              }),
            }),
          }),
        }),
      }),
    }),
  },
}));

describe("audit-log", () => {
  describe("auditToCsv", () => {
    it("returns empty string for empty array", () => {
      expect(auditToCsv([])).toBe("");
    });

    it("generates valid CSV with headers", () => {
      const entries = [{
        ts: "2025-06-01T12:00:00Z",
        engine_version: "v4.1",
        event_type: "SCORING_CYCLE",
        netuid: null,
        subnet_count: 50,
        data_confidence: 85,
        alignment_status: "OK",
        kill_switch_active: false,
        decision_reason: "Normal cycle",
        inputs: { avgOpp: 60 },
        outputs: { enterCount: 5 },
        top_factors: [],
        snapshot_ids: ["unified:2025-06-01"],
        kill_switch_triggers: [],
      }];

      const csv = auditToCsv(entries);
      const lines = csv.split("\n");
      expect(lines.length).toBe(2); // header + 1 row
      expect(lines[0]).toContain("ts");
      expect(lines[0]).toContain("event_type");
      expect(lines[1]).toContain("SCORING_CYCLE");
    });

    it("escapes quotes in CSV values", () => {
      const entries = [{
        ts: "2025-06-01T12:00:00Z",
        engine_version: "v4.1",
        event_type: "ALERT_FIRED",
        netuid: 18,
        subnet_count: null,
        data_confidence: 70,
        alignment_status: "STALE",
        kill_switch_active: false,
        decision_reason: 'Alert "critical" fired',
        inputs: {},
        outputs: {},
        top_factors: [],
        snapshot_ids: [],
        kill_switch_triggers: [],
      }];

      const csv = auditToCsv(entries);
      expect(csv).toContain('""critical""');
    });
  });

  describe("auditToJson", () => {
    it("returns valid JSON", () => {
      const entries = [{ event_type: "SCORING_CYCLE", ts: "2025-06-01" }];
      const json = auditToJson(entries);
      const parsed = JSON.parse(json);
      expect(parsed).toHaveLength(1);
      expect(parsed[0].event_type).toBe("SCORING_CYCLE");
    });
  });
});
