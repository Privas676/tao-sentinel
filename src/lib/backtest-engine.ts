/**
 * Backtest Engine — Client-side replay of DecisionLayer on historical snapshots.
 *
 * Computes:
 * 1. False Positive Rate  (alerts not confirmed by subsequent events)
 * 2. False Negative Rate  (events without prior alert)
 * 3. Average Detection Delay (time between alert and confirming event)
 * 4. Flapping Rate (state changes per subnet per hour)
 */

/* ── Types ── */

export type SnapshotSubnet = {
  netuid: number;
  price: number;
  price_5m: number;
  price_1h: number;
  liq: number;
  liq_1h: number;
  miners: number;
  miners_delta: number;
  price_max_7d: number;
  mpi_raw: number;
  M: number;
  A: number;
  L: number;
  B: number;
  Q: number;
  mpi: number;
  quality: number;
  confidence: number;
  state: string;
  gating_fail: boolean;
  breakout: boolean;
};

export type PipelineSnapshot = {
  ts: string;
  snapshot: SnapshotSubnet[];
  subnet_count: number;
  engine_version: string;
};

export type HistoricalEvent = {
  ts: string;
  netuid: number | null;
  type: string | null;
  severity: number | null;
};

export type TickMetric = {
  ts: string;
  alertCount: number;
  eventCount: number;
  stateChanges: number;
  activeSubnets: number;
  avgMpi: number;
  avgConfidence: number;
};

export type BacktestResult = {
  period: { from: string; to: string };
  tickCount: number;
  subnetCount: number;
  falsePositiveRate: number;     // 0-100%
  falseNegativeRate: number;     // 0-100%
  avgDetectionDelayMs: number;   // milliseconds
  avgDetectionDelayMin: number;  // minutes
  flappingRate: number;          // state changes per subnet per hour
  tickMetrics: TickMetric[];
  details: {
    totalAlerts: number;
    confirmedAlerts: number;
    unconfirmedAlerts: number;
    totalEvents: number;
    eventsWithPriorAlert: number;
    eventsMissed: number;
    totalStateChanges: number;
    totalSubnetHours: number;
  };
};

/* ── Alert-worthy states ── */
const ALERT_STATES = new Set(["GO", "GO_SPECULATIVE", "EARLY"]);
const CRITICAL_EVENT_TYPES = new Set([
  "DEPEG_WARNING", "DEPEG_CRITICAL", "BREAK", "EXIT_FAST", "RISK_OVERRIDE",
]);
const CONFIRMING_EVENT_TYPES = new Set([
  "GO", "GO_SPECULATIVE", "EARLY", "SMART_ACCUMULATION",
]);

/* ── Core backtest function ── */

export function runBacktest(
  snapshots: PipelineSnapshot[],
  events: HistoricalEvent[],
): BacktestResult {
  if (snapshots.length === 0) {
    return emptyResult();
  }

  // Sort chronologically
  const sorted = [...snapshots].sort(
    (a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime()
  );
  const sortedEvents = [...events].sort(
    (a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime()
  );

  const from = sorted[0].ts;
  const to = sorted[sorted.length - 1].ts;
  const periodMs = new Date(to).getTime() - new Date(from).getTime();

  // Collect all unique subnets
  const allNetuids = new Set<number>();
  for (const snap of sorted) {
    for (const s of snap.snapshot) allNetuids.add(s.netuid);
  }

  // ── 1. Track alerts (GO/EARLY states) ──
  type AlertRecord = { netuid: number; ts: number; state: string; confirmed: boolean };
  const alerts: AlertRecord[] = [];
  const prevStates = new Map<number, string>();

  // ── 4. Track state changes for flapping ──
  let totalStateChanges = 0;
  const tickMetrics: TickMetric[] = [];

  for (const snap of sorted) {
    const snapTs = new Date(snap.ts).getTime();
    let tickAlerts = 0;
    let tickStateChanges = 0;
    let mpiSum = 0;
    let confSum = 0;

    for (const sub of snap.snapshot) {
      const prev = prevStates.get(sub.netuid);
      if (prev && prev !== sub.state) {
        totalStateChanges++;
        tickStateChanges++;
      }
      prevStates.set(sub.netuid, sub.state);
      mpiSum += sub.mpi ?? 0;
      confSum += sub.confidence ?? 0;

      // Record alert if entering an alert state
      if (ALERT_STATES.has(sub.state) && (!prev || !ALERT_STATES.has(prev))) {
        alerts.push({ netuid: sub.netuid, ts: snapTs, state: sub.state, confirmed: false });
        tickAlerts++;
      }
    }

    const n = snap.snapshot.length || 1;
    // Count events in ±5min window of this tick
    const tickEvents = sortedEvents.filter(
      (e) => Math.abs(new Date(e.ts).getTime() - snapTs) <= 5 * 60 * 1000
    ).length;

    tickMetrics.push({
      ts: snap.ts,
      alertCount: tickAlerts,
      eventCount: tickEvents,
      stateChanges: tickStateChanges,
      activeSubnets: snap.snapshot.length,
      avgMpi: Math.round(mpiSum / n),
      avgConfidence: Math.round(confSum / n),
    });
  }

  // ── 2. Match alerts to confirming events (within 60 min window) ──
  const CONFIRM_WINDOW_MS = 60 * 60 * 1000; // 1 hour

  const confirmingEvents = sortedEvents.filter(
    (e) => e.type && CONFIRMING_EVENT_TYPES.has(e.type)
  );

  for (const alert of alerts) {
    const match = confirmingEvents.find(
      (e) =>
        e.netuid === alert.netuid &&
        new Date(e.ts).getTime() >= alert.ts &&
        new Date(e.ts).getTime() - alert.ts <= CONFIRM_WINDOW_MS
    );
    if (match) alert.confirmed = true;
  }

  const totalAlerts = alerts.length;
  const confirmedAlerts = alerts.filter((a) => a.confirmed).length;
  const unconfirmedAlerts = totalAlerts - confirmedAlerts;
  const falsePositiveRate = totalAlerts > 0 ? (unconfirmedAlerts / totalAlerts) * 100 : 0;

  // ── 3. False negatives: critical events without prior alert ──
  const criticalEvents = sortedEvents.filter(
    (e) => e.type && CRITICAL_EVENT_TYPES.has(e.type) && e.netuid != null
  );
  const PRIOR_ALERT_WINDOW_MS = 30 * 60 * 1000; // 30 min before

  let eventsWithPriorAlert = 0;
  const detectionDelays: number[] = [];

  for (const evt of criticalEvents) {
    const evtTs = new Date(evt.ts).getTime();
    // Find any alert for this subnet in the prior window
    const priorAlert = alerts.find(
      (a) =>
        a.netuid === evt.netuid &&
        a.ts <= evtTs &&
        evtTs - a.ts <= PRIOR_ALERT_WINDOW_MS
    );
    if (priorAlert) {
      eventsWithPriorAlert++;
      detectionDelays.push(evtTs - priorAlert.ts);
    }
  }

  const totalCriticalEvents = criticalEvents.length;
  const eventsMissed = totalCriticalEvents - eventsWithPriorAlert;
  const falseNegativeRate = totalCriticalEvents > 0
    ? (eventsMissed / totalCriticalEvents) * 100
    : 0;

  const avgDetectionDelayMs = detectionDelays.length > 0
    ? detectionDelays.reduce((a, b) => a + b, 0) / detectionDelays.length
    : 0;

  // ── 4. Flapping rate ──
  const totalSubnetHours = (allNetuids.size * periodMs) / (3600 * 1000);
  const flappingRate = totalSubnetHours > 0
    ? totalStateChanges / totalSubnetHours
    : 0;

  return {
    period: { from, to },
    tickCount: sorted.length,
    subnetCount: allNetuids.size,
    falsePositiveRate: Math.round(falsePositiveRate * 10) / 10,
    falseNegativeRate: Math.round(falseNegativeRate * 10) / 10,
    avgDetectionDelayMs,
    avgDetectionDelayMin: Math.round(avgDetectionDelayMs / 60000 * 10) / 10,
    flappingRate: Math.round(flappingRate * 100) / 100,
    tickMetrics,
    details: {
      totalAlerts,
      confirmedAlerts,
      unconfirmedAlerts,
      totalEvents: totalCriticalEvents,
      eventsWithPriorAlert,
      eventsMissed,
      totalStateChanges,
      totalSubnetHours: Math.round(totalSubnetHours),
    },
  };
}

function emptyResult(): BacktestResult {
  return {
    period: { from: "", to: "" },
    tickCount: 0,
    subnetCount: 0,
    falsePositiveRate: 0,
    falseNegativeRate: 0,
    avgDetectionDelayMs: 0,
    avgDetectionDelayMin: 0,
    flappingRate: 0,
    tickMetrics: [],
    details: {
      totalAlerts: 0, confirmedAlerts: 0, unconfirmedAlerts: 0,
      totalEvents: 0, eventsWithPriorAlert: 0, eventsMissed: 0,
      totalStateChanges: 0, totalSubnetHours: 0,
    },
  };
}
