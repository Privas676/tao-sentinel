/* ═══════════════════════════════════════════════════════ */
/*   TEST: TaoFlute blocking rules                        */
/*   Validates that subnets in TaoFlute delist/priority    */
/*   list cannot receive ENTRER verdict.                  */
/* ═══════════════════════════════════════════════════════ */

import { describe, it, expect } from "vitest";
import {
  resolveTaoFluteStatus,
  TAOFLUTE_PRIORITY_CONFIRMED,
  TAOFLUTE_WATCH_CONFIRMED,
} from "@/lib/taoflute-resolver";

describe("TaoFlute blocking rules", () => {
  it("priority subnets always resolve to severity=priority", () => {
    for (const netuid of TAOFLUTE_PRIORITY_CONFIRMED) {
      const status = resolveTaoFluteStatus(netuid);
      expect(status.taoflute_severity).toBe("priority");
      expect(status.taoflute_match).toBe(true);
    }
  });

  it("watch subnets always resolve to severity=watch", () => {
    for (const netuid of TAOFLUTE_WATCH_CONFIRMED) {
      const status = resolveTaoFluteStatus(netuid);
      expect(status.taoflute_severity).toBe("watch");
      expect(status.taoflute_match).toBe(true);
    }
  });

  it("SN-64 (Chutes) is always excluded — severity=none", () => {
    const status = resolveTaoFluteStatus(64);
    expect(status.taoflute_match).toBe(false);
    expect(status.taoflute_severity).toBe("none");
    expect(status.externalRisk).toBeNull();
  });

  it("DB priority data takes precedence over hardcoded fallback", () => {
    const dbPriority = new Map([[99, { rank: 3, source: "taoflute_grafana", lastSeen: "2026-03-29" }]]);
    const status = resolveTaoFluteStatus(99, dbPriority);
    expect(status.taoflute_severity).toBe("priority");
    expect(status.taoflute_priority_rank).toBe(3);
    // SN-99 is in WATCH hardcoded list, but DB priority should win
  });

  it("DB watch data takes precedence for non-priority subnets", () => {
    const dbWatch = new Map([[999, { source: "taoflute_grafana", lastSeen: "2026-03-29" }]]);
    const status = resolveTaoFluteStatus(999, undefined, dbWatch);
    expect(status.taoflute_severity).toBe("watch");
    expect(status.taoflute_match).toBe(true);
  });

  it("unknown subnet has no TaoFlute match", () => {
    const status = resolveTaoFluteStatus(1);
    expect(status.taoflute_match).toBe(false);
    expect(status.taoflute_severity).toBe("none");
  });

  it("exclusion overrides even DB data", () => {
    const dbPriority = new Map([[64, { rank: 1, source: "taoflute_grafana", lastSeen: "2026-03-29" }]]);
    const status = resolveTaoFluteStatus(64, dbPriority);
    expect(status.taoflute_match).toBe(false);
    expect(status.taoflute_severity).toBe("none");
  });

  it("priority subnets in current DB match (SN-78 P1, SN-57 P3)", () => {
    const dbPriority = new Map([
      [78, { rank: 1, source: "taoflute_grafana", lastSeen: "2026-03-29" }],
      [57, { rank: 3, source: "taoflute_grafana", lastSeen: "2026-03-29" }],
    ]);
    
    const s78 = resolveTaoFluteStatus(78, dbPriority);
    expect(s78.taoflute_severity).toBe("priority");
    expect(s78.taoflute_priority_rank).toBe(1);

    const s57 = resolveTaoFluteStatus(57, dbPriority);
    expect(s57.taoflute_severity).toBe("priority");
    expect(s57.taoflute_priority_rank).toBe(3);
  });
});
