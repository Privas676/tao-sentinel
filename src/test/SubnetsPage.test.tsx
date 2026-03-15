import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { BrowserRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TooltipProvider } from "@/components/ui/tooltip";
import SubnetsPage from "@/pages/SubnetsPage";
import type { UnifiedSubnetScore } from "@/hooks/use-subnet-scores";

// ── Mock SubnetDecision factory ──
function makeDecision(netuid: number, name: string, overrides: Record<string, any> = {}) {
  return {
    netuid, name,
    finalAction: "SURVEILLER" as const,
    engineAction: "WATCH" as const,
    actionFr: "SURVEILLER", actionEn: "MONITOR",
    badgeAction: "SURVEILLER" as const,
    isSystem: false,
    rawSignal: { type: "WATCH", reasons: [] },
    isBlocked: false, blockReasons: [],
    primaryReason: "Signal neutre",
    portfolioAction: "CONSERVER", portfolioActionFr: "CONSERVER", portfolioActionEn: "HOLD",
    conviction: "MEDIUM" as const, convictionScore: 50,
    opp: 50, risk: 50, asymmetry: 0, confidence: 60, momentumScore: 50, momentumLabel: "STABLE", stability: 50,
    liquidityLevel: "MEDIUM" as const, structureLevel: "HEALTHY" as const, statusLevel: "OK" as const,
    signalPrincipal: "Observation", thesis: [], invalidation: [], conflictExplanation: null,
    isOverridden: false, dataUncertain: false, depegProbability: 0, delistCategory: "NORMAL", delistScore: 10,
    taoFluteStatus: { taoflute_match: false, taoflute_severity: null },
    score: {} as any, verdict: undefined,
    ...overrides,
  };
}

// ── Mock data: 4 subnets ──
const mockScoresList: UnifiedSubnetScore[] = [
  {
    netuid: 1, name: "Alpha", assetType: "SPECULATIVE", state: "GO", psi: 80, conf: 70, quality: 65,
    opp: 72, risk: 25, asymmetry: 47, momentum: 60, momentumLabel: "FORT",
    momentumScore: 70, action: "ENTER", sc: "ACCUMULATION", confianceScore: 80,
    dataUncertain: false, isOverridden: false, isWarning: false, systemStatus: "OK",
    overrideReasons: [], healthScores: {} as any, recalc: {} as any,
    displayedCap: 100000, displayedLiq: 5000, stability: 70, consensusPrice: 0.05,
    alphaPrice: 0.05, priceVar30d: 15, delistCategory: "NORMAL" as const, delistScore: 10,
  },
  {
    netuid: 3, name: "Charlie", assetType: "SPECULATIVE", state: "EARLY", psi: 60, conf: 55, quality: 50,
    opp: 55, risk: 40, asymmetry: 15, momentum: 45, momentumLabel: "STABLE",
    momentumScore: 45, action: "WATCH", sc: "STABLE", confianceScore: 65,
    dataUncertain: false, isOverridden: false, isWarning: false, systemStatus: "OK",
    overrideReasons: [], healthScores: {} as any, recalc: {} as any,
    displayedCap: 50000, displayedLiq: 3000, stability: 55, consensusPrice: 0.02,
    alphaPrice: 0.02, priceVar30d: 5, delistCategory: "NORMAL" as const, delistScore: 15,
  },
  {
    netuid: 6, name: "Bravo", assetType: "SPECULATIVE", state: "BREAK", psi: 30, conf: 40, quality: 20,
    opp: 0, risk: 85, asymmetry: -85, momentum: 15, momentumLabel: "DÉTÉRIORATION",
    momentumScore: 10, action: "EXIT", sc: "DISTRIBUTION", confianceScore: 40,
    dataUncertain: false, isOverridden: true, isWarning: false, systemStatus: "ZONE_CRITIQUE" as const,
    overrideReasons: ["Zone critique"], healthScores: {} as any, recalc: {} as any,
    displayedCap: 5000, displayedLiq: 200, stability: 20, consensusPrice: 0.001,
    alphaPrice: 0.001, priceVar30d: -40, delistCategory: "HIGH_RISK_NEAR_DELIST" as const, delistScore: 80,
  },
  {
    netuid: 9, name: "Delta", assetType: "SPECULATIVE", state: "WATCH", psi: 50, conf: 50, quality: 45,
    opp: 60, risk: 55, asymmetry: 5, momentum: 35, momentumLabel: "STABLE",
    momentumScore: 35, action: "HOLD", sc: "STABLE", confianceScore: 55,
    dataUncertain: false, isOverridden: false, isWarning: false, systemStatus: "SURVEILLANCE" as const,
    overrideReasons: [], healthScores: {} as any, recalc: {} as any,
    displayedCap: 20000, displayedLiq: 1000, stability: 45, consensusPrice: 0.01,
    alphaPrice: 0.01, priceVar30d: -10, delistCategory: "NORMAL" as const, delistScore: 25,
  },
];

const mockDecisions = [
  makeDecision(1, "Alpha", { finalAction: "ENTRER", opp: 72, risk: 25, conviction: "HIGH", convictionScore: 80 }),
  makeDecision(3, "Charlie", { finalAction: "SURVEILLER", opp: 55, risk: 40 }),
  makeDecision(6, "Bravo", { finalAction: "SORTIR", opp: 0, risk: 85, isOverridden: true, statusLevel: "DANGER" }),
  makeDecision(9, "Delta", { finalAction: "SURVEILLER", opp: 60, risk: 55, statusLevel: "WATCH" }),
];

const mockDecisionsMap = new Map(mockDecisions.map(d => [d.netuid, d]));

vi.mock("@/hooks/use-subnet-scores", () => ({
  useSubnetScores: () => ({
    scoresList: mockScoresList,
    scores: new Map(mockScoresList.map(s => [s.netuid, s])),
    sparklines: new Map([[1, [0.04, 0.045, 0.05]], [6, [0.002, 0.0015, 0.001]]]),
    scoreTimestamp: "2026-03-01T12:00:00Z",
    taoUsd: 450,
    isLoading: false,
    subnetList: mockScoresList.map(s => ({ netuid: s.netuid, name: s.name })),
    marketContext: new Map(),
    dataAlignment: "ALIGNED",
    dataAgeDebug: [],
    subnetFacts: new Map(),
  }),
  SPECIAL_SUBNETS: { 0: { label: "ROOT", forceStatus: "OK", forceAction: "HOLD", forceRiskMax: 20, isSystem: true } },
  getSubnetScore: (map: any, id: number) => map.get(id),
}));

vi.mock("@/hooks/use-local-portfolio", () => ({
  useLocalPortfolio: () => ({
    positions: [],
    ownedNetuids: new Set<number>(),
    isOwned: () => false,
    addPosition: vi.fn(),
    removePosition: vi.fn(),
    sellPosition: vi.fn(),
    updateQuantity: vi.fn(),
    archive: [],
  }),
}));

vi.mock("@/lib/i18n", () => ({
  useI18n: () => ({
    lang: "fr",
    t: (key: string) => key,
    setLang: vi.fn(),
  }),
}));

vi.mock("@/hooks/use-delist-mode", () => ({
  useDelistMode: () => ({ delistMode: false }),
}));

vi.mock("@/hooks/use-canonical-subnets", () => ({
  useCanonicalSubnets: () => ({
    facts: new Map(),
    canonicalDecisions: new Map(),
    decisions: mockDecisionsMap,
    decisionsList: mockDecisions,
    isLoading: false,
  }),
}));

vi.mock("@/hooks/use-subnet-verdict", () => ({
  useSubnetVerdicts: () => ({
    verdicts: new Map(), verdictList: [],
    topRentre: [], topHold: [], topSors: [],
    isLoading: false, countRentre: 0, countHold: 0, countSors: 0,
  }),
}));

vi.mock("@/hooks/use-external-delist", () => ({
  useExternalDelist: () => ({ taoFluteStatuses: new Map(), priorityList: [], watchList: [], isLoading: false }),
}));

vi.mock("@/hooks/use-mobile", () => ({
  useIsMobile: () => false,
}));

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <TooltipProvider>
        <BrowserRouter>
          <SubnetsPage />
        </BrowserRouter>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

describe("SubnetsPage", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("renders page title", () => {
    renderPage();
    expect(screen.getByText("Subnet Intelligence")).toBeInTheDocument();
  });

  it("renders all 4 subnet rows", () => {
    renderPage();
    expect(screen.getByText("Alpha")).toBeInTheDocument();
    expect(screen.getByText("Bravo")).toBeInTheDocument();
    expect(screen.getByText("Charlie")).toBeInTheDocument();
    expect(screen.getByText("Delta")).toBeInTheDocument();
  });

  it("displays opportunity and risk scores", () => {
    renderPage();
    expect(screen.getByText("72")).toBeInTheDocument();
    expect(screen.getByText("85")).toBeInTheDocument();
  });

  it("shows overridden subnet with SORTIR action", () => {
    renderPage();
    const exitElements = screen.getAllByText(/SORTIR/);
    expect(exitElements.length).toBeGreaterThanOrEqual(1);
  });
});
