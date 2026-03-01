import { describe, it, expect, vi, beforeEach } from "vitest";
// @ts-expect-error -- @testing-library/dom types re-exported at runtime
import { render, screen, fireEvent } from "@testing-library/react";
import { BrowserRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { UnifiedSubnetScore } from "@/hooks/use-subnet-scores";

// ── Mock hooks ──
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
    netuid: 6, name: "Bravo", assetType: "SPECULATIVE", state: "BREAK", psi: 30, conf: 40, quality: 20,
    opp: 0, risk: 85, asymmetry: -85, momentum: 15, momentumLabel: "DÉTÉRIORATION",
    momentumScore: 10, action: "EXIT", sc: "DISTRIBUTION", confianceScore: 40,
    dataUncertain: false, isOverridden: true, isWarning: false, systemStatus: "ZONE_CRITIQUE" as const,
    overrideReasons: ["Zone critique"], healthScores: {} as any, recalc: {} as any,
    displayedCap: 5000, displayedLiq: 200, stability: 20, consensusPrice: 0.001,
    alphaPrice: 0.001, priceVar30d: -40, delistCategory: "HIGH_RISK_NEAR_DELIST" as const, delistScore: 80,
  },
];

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
  }),
  SPECIAL_SUBNETS: { 0: { label: "ROOT", forceStatus: "OK", forceAction: "HOLD", forceRiskMax: 20 } },
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
    t: (key: string) => {
      const map: Record<string, string> = {
        "sub.title": "Subnets Détaillés",
        "sub.name": "Nom",
        "sub.opp": "Opportunité",
        "sub.risk": "Risque",
        "sub.momentum": "Momentum",
        "sub.mode_all": "Tous",
        "sub.mode_opp": "Opportunités",
        "sub.mode_risk": "Risques",
        "tip.price7d": "Prix 7j",
        "sc.label": "SMART CAPITAL",
        "data.confiance": "CONFIANCE DATA",
      };
      return map[key] ?? key;
    },
    setLang: vi.fn(),
  }),
}));

vi.mock("@/hooks/use-delist-mode", () => ({
  useDelistMode: () => ({ delistMode: false }),
}));

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  // Dynamic import to get mocked version
  const SubnetsPage = require("@/pages/SubnetsPage").default;
  return render(
    <QueryClientProvider client={qc}>
      <BrowserRouter>
        <SubnetsPage />
      </BrowserRouter>
    </QueryClientProvider>
  );
}

describe("SubnetsPage", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("renders page title", () => {
    renderPage();
    expect(screen.getByText("Subnets Détaillés")).toBeInTheDocument();
  });

  it("renders all filter mode buttons", () => {
    renderPage();
    expect(screen.getByText("Tous")).toBeInTheDocument();
    expect(screen.getByText("Opportunités")).toBeInTheDocument();
    expect(screen.getByText("Risques")).toBeInTheDocument();
  });

  it("renders subnet rows", () => {
    renderPage();
    expect(screen.getByText("Alpha")).toBeInTheDocument();
    expect(screen.getByText("Bravo")).toBeInTheDocument();
  });

  it("displays opportunity and risk scores", () => {
    renderPage();
    expect(screen.getByText("72")).toBeInTheDocument(); // Alpha opp
    expect(screen.getByText("85")).toBeInTheDocument(); // Bravo risk
  });

  it("renders timestamp badge", () => {
    renderPage();
    // Score timestamp should be visible
    const badge = screen.getByTitle(/Score snapshot/);
    expect(badge).toBeInTheDocument();
  });

  it("displays column headers", () => {
    renderPage();
    expect(screen.getByText(/SN/)).toBeInTheDocument();
    expect(screen.getByText("Opportunité")).toBeInTheDocument();
    expect(screen.getByText("Risque")).toBeInTheDocument();
    expect(screen.getByText("Momentum")).toBeInTheDocument();
  });

  it("shows overridden subnet with EXIT action", () => {
    renderPage();
    // Bravo (netuid 6) is overridden with EXIT action
    const exitElements = screen.getAllByText(/SORTIR|EXIT/);
    expect(exitElements.length).toBeGreaterThanOrEqual(1);
  });

  it("shows SMART CAPITAL column header", () => {
    renderPage();
    expect(screen.getByText("SMART CAPITAL")).toBeInTheDocument();
  });
});
