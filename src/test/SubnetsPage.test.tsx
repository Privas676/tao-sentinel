import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { BrowserRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TooltipProvider } from "@/components/ui/tooltip";
import SubnetsPage from "@/pages/SubnetsPage";
import type { UnifiedSubnetScore } from "@/hooks/use-subnet-scores";

// ── Mock data: 4 subnets for richer interaction tests ──
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

vi.mock("@/hooks/use-canonical-subnets", () => ({
  useCanonicalSubnets: () => ({
    facts: new Map(),
    canonicalDecisions: new Map(),
    decisions: new Map(),
    decisionsList: [],
    isLoading: false,
  }),
}));

vi.mock("@/hooks/use-subnet-verdict", () => ({
  useSubnetVerdicts: () => ({ verdicts: new Map(), isLoading: false }),
}));

vi.mock("@/hooks/use-external-delist", () => ({
  useExternalDelist: () => ({ taoFluteStatuses: new Map(), priorityList: [], watchList: [], isLoading: false }),
}));

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
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

  it("renders all 4 subnet rows", () => {
    renderPage();
    expect(screen.getByText("Alpha")).toBeInTheDocument();
    expect(screen.getByText("Bravo")).toBeInTheDocument();
    expect(screen.getByText("Charlie")).toBeInTheDocument();
    expect(screen.getByText("Delta")).toBeInTheDocument();
  });

  it("displays opportunity and risk scores", () => {
    renderPage();
    expect(screen.getByText("72")).toBeInTheDocument(); // Alpha opp
    expect(screen.getByText("85")).toBeInTheDocument(); // Bravo risk
  });

  it("renders timestamp badge", () => {
    renderPage();
    const badge = screen.getByTitle(/Score snapshot/);
    expect(badge).toBeInTheDocument();
  });

  it("displays column headers", () => {
    renderPage();
    expect(screen.getByText(/SN/)).toBeInTheDocument();
    expect(screen.getByText("Opportunité")).toBeInTheDocument();
    expect(screen.getByText("Risque")).toBeInTheDocument();
    const thead = document.querySelector("thead")!;
    expect(within(thead).getByText("Momentum")).toBeInTheDocument();
  });

  it("shows overridden subnet with EXIT action", () => {
    renderPage();
    const exitElements = screen.getAllByText(/SORTIR|EXIT/);
    expect(exitElements.length).toBeGreaterThanOrEqual(1);
  });

  it("shows SMART CAPITAL column header", () => {
    renderPage();
    expect(screen.getByText("SMART CAPITAL")).toBeInTheDocument();
  });
});

/* ══════════════════════════════════════════════ */
/*      INTERACTION TESTS: Filter modes           */
/* ══════════════════════════════════════════════ */
describe("SubnetsPage — Filter interactions", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("Opportunités filter hides overridden and risk-dominant subnets", () => {
    renderPage();
    fireEvent.click(screen.getByText("Opportunités"));
    // Alpha (opp 72 > risk 25) and Charlie (opp 55 > risk 40) should show
    expect(screen.getByText("Alpha")).toBeInTheDocument();
    expect(screen.getByText("Charlie")).toBeInTheDocument();
    // Bravo (overridden) and Delta (risk 55 >= opp 60... opp>risk so shows) 
    // Bravo is overridden → hidden
    expect(screen.queryByText("Bravo")).not.toBeInTheDocument();
  });

  it("Risques filter shows risk-dominant subnets", () => {
    renderPage();
    fireEvent.click(screen.getByText("Risques"));
    // Bravo (risk 85 >= opp 0) should show
    expect(screen.getByText("Bravo")).toBeInTheDocument();
    // Alpha (opp > risk) should be hidden
    expect(screen.queryByText("Alpha")).not.toBeInTheDocument();
  });

  it("switching back to Tous shows all subnets", () => {
    renderPage();
    fireEvent.click(screen.getByText("Opportunités"));
    fireEvent.click(screen.getByText("Tous"));
    expect(screen.getByText("Alpha")).toBeInTheDocument();
    expect(screen.getByText("Bravo")).toBeInTheDocument();
    expect(screen.getByText("Charlie")).toBeInTheDocument();
    expect(screen.getByText("Delta")).toBeInTheDocument();
  });
});

/* ══════════════════════════════════════════════ */
/*      INTERACTION TESTS: Column sorting          */
/* ══════════════════════════════════════════════ */
describe("SubnetsPage — Column sorting", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  function getRowNetuids(): number[] {
    const tbody = document.querySelector("tbody");
    if (!tbody) return [];
    const rows = tbody.querySelectorAll("tr");
    return Array.from(rows).map(row => {
      const firstCell = row.querySelector("td");
      return firstCell ? parseInt(firstCell.textContent || "0") : 0;
    });
  }

  it("clicking SN header sorts by netuid descending", () => {
    renderPage();
    // Click "SN" header
    const headers = screen.getAllByRole("columnheader");
    const snHeader = headers.find(h => h.textContent?.includes("SN"));
    expect(snHeader).toBeDefined();
    fireEvent.click(snHeader!);
    // Should sort desc: 9, 6, 3, 1
    const ids = getRowNetuids();
    expect(ids[0]).toBe(9);
    expect(ids[ids.length - 1]).toBe(1);
  });

  it("clicking SN twice sorts ascending", () => {
    renderPage();
    const headers = screen.getAllByRole("columnheader");
    const snHeader = headers.find(h => h.textContent?.includes("SN"));
    fireEvent.click(snHeader!); // desc
    fireEvent.click(snHeader!); // asc
    const ids = getRowNetuids();
    expect(ids[0]).toBe(1);
    expect(ids[ids.length - 1]).toBe(9);
  });

  it("clicking SN three times resets to default sort", () => {
    renderPage();
    const headers = screen.getAllByRole("columnheader");
    const snHeader = headers.find(h => h.textContent?.includes("SN"));
    fireEvent.click(snHeader!); // desc
    fireEvent.click(snHeader!); // asc
    fireEvent.click(snHeader!); // reset
    // ▼ and ▲ indicators should be gone
    expect(snHeader!.textContent).not.toContain("▼");
    expect(snHeader!.textContent).not.toContain("▲");
  });

  it("clicking Opportunité header sorts by opp descending", () => {
    renderPage();
    const headers = screen.getAllByRole("columnheader");
    const oppHeader = headers.find(h => h.textContent?.trim().startsWith("Opportunité"));
    fireEvent.click(oppHeader!);
    const ids = getRowNetuids();
    // Alpha (72) > Delta (60) > Charlie (55) > Bravo (0)
    expect(ids[0]).toBe(1);
    expect(ids[ids.length - 1]).toBe(6);
  });

  it("clicking Risque header sorts by risk descending", () => {
    renderPage();
    const headers = screen.getAllByRole("columnheader");
    const riskHeader = headers.find(h => h.textContent?.trim().startsWith("Risque"));
    fireEvent.click(riskHeader!);
    const ids = getRowNetuids();
    // Bravo (85) > Delta (55) > Charlie (40) > Alpha (25)
    expect(ids[0]).toBe(6);
    expect(ids[ids.length - 1]).toBe(1);
  });

  it("sort indicator ▼ appears on active column", () => {
    renderPage();
    const headers = screen.getAllByRole("columnheader");
    const oppHeader = headers.find(h => h.textContent?.trim().startsWith("Opportunité"));
    fireEvent.click(oppHeader!);
    expect(oppHeader!.textContent).toContain("▼");
  });

  it("switching sort column removes indicator from previous", () => {
    renderPage();
    const headers = screen.getAllByRole("columnheader");
    const oppHeader = headers.find(h => h.textContent?.trim().startsWith("Opportunité"));
    const riskHeader = headers.find(h => h.textContent?.trim().startsWith("Risque"));
    fireEvent.click(oppHeader!);
    fireEvent.click(riskHeader!);
    // Opportunité should no longer have indicator
    expect(oppHeader!.textContent).not.toContain("▼");
    expect(oppHeader!.textContent).not.toContain("▲");
    // Risque should
    expect(riskHeader!.textContent).toContain("▼");
  });
});
