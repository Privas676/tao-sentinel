/* ═══════════════════════════════════════ */
/*   SCORE VOLATILITY MONITOR              */
/*   Measures PSI/Risk score changes over  */
/*   time from pipeline_snapshots          */
/* ═══════════════════════════════════════ */

export type SnapshotEntry = {
  netuid: number;
  mpi: number;       // PSI
  quality: number;   // used to derive risk proxy
  ts: string;
};

export type SubnetVolatility = {
  netuid: number;
  deltaPsiMean1h: number;   // avg |ΔPSI| per hour
  deltaPsiMax1h: number;    // max |ΔPSI| in any 1h window
  deltaRiskMean1h: number;  // avg |ΔRisk| per hour
  deltaRiskMax1h: number;   // max |ΔRisk| in any 1h window
};

export type FleetVolatilityReport = {
  window: "24h" | "7d";
  subnetCount: number;
  snapshotCount: number;
  // Global averages
  avgDeltaPsi: number;
  avgDeltaRisk: number;
  // Fleet instability %
  pctPsiAbove20: number;    // % subnets with ΔPSI > 20 in 1h
  pctRiskAbove25: number;   // % subnets with ΔRisk > 25 in 1h
  // Flag
  scoreInstability: boolean; // >20% subnets exceed thresholds
  scoreInstabilityPsi: boolean;
  scoreInstabilityRisk: boolean;
  // Per-subnet detail
  subnets: SubnetVolatility[];
};

const PSI_INSTABILITY_THRESHOLD = 20;
const RISK_INSTABILITY_THRESHOLD = 25;
const FLEET_INSTABILITY_PCT = 0.20; // 20%

/**
 * Parse pipeline_snapshots rows into per-subnet time series.
 * Each snapshot row contains a JSON array of subnet entries.
 */
export function parseSnapshots(
  rows: { ts: string; snapshot: any[] }[],
): Map<number, { ts: number; psi: number; risk: number }[]> {
  const map = new Map<number, { ts: number; psi: number; risk: number }[]>();

  for (const row of rows) {
    const tsMs = new Date(row.ts).getTime();
    const entries = Array.isArray(row.snapshot) ? row.snapshot : [];
    for (const e of entries) {
      if (e.netuid == null) continue;
      const netuid = Number(e.netuid);
      const psi = Number(e.mpi) || 0;
      // Risk proxy: invert quality (high quality = low risk)
      const risk = 100 - (Number(e.quality) || 50);
      if (!map.has(netuid)) map.set(netuid, []);
      map.get(netuid)!.push({ ts: tsMs, psi, risk });
    }
  }

  // Sort each series by time
  for (const [, series] of map) {
    series.sort((a, b) => a.ts - b.ts);
  }

  return map;
}

/**
 * Compute hourly deltas for a single time series.
 * Groups consecutive points into ~1h windows and measures change.
 */
function computeHourlyDeltas(
  series: { ts: number; psi: number; risk: number }[],
): { deltaPsiMean: number; deltaPsiMax: number; deltaRiskMean: number; deltaRiskMax: number } {
  if (series.length < 2) {
    return { deltaPsiMean: 0, deltaPsiMax: 0, deltaRiskMean: 0, deltaRiskMax: 0 };
  }

  const ONE_HOUR = 3600_000;
  const deltaPsiList: number[] = [];
  const deltaRiskList: number[] = [];

  // Sliding window: for each point, find the point ~1h later
  for (let i = 0; i < series.length; i++) {
    const start = series[i];
    // Find closest point to start + 1h
    let bestJ = -1;
    let bestDist = Infinity;
    for (let j = i + 1; j < series.length; j++) {
      const dist = Math.abs((series[j].ts - start.ts) - ONE_HOUR);
      if (dist < bestDist) {
        bestDist = dist;
        bestJ = j;
      }
      // Stop searching if we're past 2h
      if (series[j].ts - start.ts > 2 * ONE_HOUR) break;
    }
    // Accept if within 30min of target
    if (bestJ >= 0 && bestDist < 30 * 60_000) {
      const end = series[bestJ];
      deltaPsiList.push(Math.abs(end.psi - start.psi));
      deltaRiskList.push(Math.abs(end.risk - start.risk));
    }
  }

  if (deltaPsiList.length === 0) {
    return { deltaPsiMean: 0, deltaPsiMax: 0, deltaRiskMean: 0, deltaRiskMax: 0 };
  }

  const mean = (arr: number[]) => arr.reduce((a, b) => a + b, 0) / arr.length;

  return {
    deltaPsiMean: Math.round(mean(deltaPsiList) * 10) / 10,
    deltaPsiMax: Math.round(Math.max(...deltaPsiList) * 10) / 10,
    deltaRiskMean: Math.round(mean(deltaRiskList) * 10) / 10,
    deltaRiskMax: Math.round(Math.max(...deltaRiskList) * 10) / 10,
  };
}

/**
 * Analyze score volatility across the fleet.
 */
export function analyzeScoreVolatility(
  snapshotRows: { ts: string; snapshot: any[] }[],
  window: "24h" | "7d" = "24h",
): FleetVolatilityReport {
  const seriesMap = parseSnapshots(snapshotRows);

  const subnets: SubnetVolatility[] = [];
  for (const [netuid, series] of seriesMap) {
    const deltas = computeHourlyDeltas(series);
    subnets.push({
      netuid,
      deltaPsiMean1h: deltas.deltaPsiMean,
      deltaPsiMax1h: deltas.deltaPsiMax,
      deltaRiskMean1h: deltas.deltaRiskMean,
      deltaRiskMax1h: deltas.deltaRiskMax,
    });
  }

  const n = subnets.length;
  if (n === 0) {
    return {
      window, subnetCount: 0, snapshotCount: snapshotRows.length,
      avgDeltaPsi: 0, avgDeltaRisk: 0,
      pctPsiAbove20: 0, pctRiskAbove25: 0,
      scoreInstability: false, scoreInstabilityPsi: false, scoreInstabilityRisk: false,
      subnets: [],
    };
  }

  const avgDeltaPsi = Math.round((subnets.reduce((s, v) => s + v.deltaPsiMean1h, 0) / n) * 10) / 10;
  const avgDeltaRisk = Math.round((subnets.reduce((s, v) => s + v.deltaRiskMean1h, 0) / n) * 10) / 10;

  const countPsiAbove = subnets.filter(v => v.deltaPsiMax1h > PSI_INSTABILITY_THRESHOLD).length;
  const countRiskAbove = subnets.filter(v => v.deltaRiskMax1h > RISK_INSTABILITY_THRESHOLD).length;
  const pctPsiAbove20 = Math.round((countPsiAbove / n) * 100);
  const pctRiskAbove25 = Math.round((countRiskAbove / n) * 100);

  const scoreInstabilityPsi = countPsiAbove / n > FLEET_INSTABILITY_PCT;
  const scoreInstabilityRisk = countRiskAbove / n > FLEET_INSTABILITY_PCT;
  const scoreInstability = scoreInstabilityPsi || scoreInstabilityRisk;

  // Sort by max PSI delta desc
  subnets.sort((a, b) => b.deltaPsiMax1h - a.deltaPsiMax1h);

  return {
    window, subnetCount: n, snapshotCount: snapshotRows.length,
    avgDeltaPsi, avgDeltaRisk,
    pctPsiAbove20, pctRiskAbove25,
    scoreInstability, scoreInstabilityPsi, scoreInstabilityRisk,
    subnets,
  };
}
