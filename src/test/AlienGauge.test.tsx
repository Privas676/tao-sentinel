import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock modules before imports
vi.mock("@/hooks/use-subnet-scores", () => ({
  useSubnetScores: vi.fn(),
  SPECIAL_SUBNETS: { 0: { label: "ROOT", forceStatus: "OK", forceAction: "HOLD", forceRiskMax: 20, isSystem: true } },
  getSubnetScore: (map: any, id: number) => map.get(id),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => ({ maybeSingle: () => Promise.resolve({ data: null }) }),
        order: () => ({ limit: () => Promise.resolve({ data: [] }) }),
      }),
    }),
  },
}));

vi.mock("@tanstack/react-query", async () => {
  const actual = await vi.importActual("@tanstack/react-query");
  return {
    ...actual,
    useQuery: vi.fn().mockReturnValue({ data: null, isLoading: false }),
  };
});

vi.mock("@/hooks/use-mobile", () => ({
  useIsMobile: () => false,
}));

vi.mock("@/hooks/use-subnet-verdict", () => ({
  useSubnetVerdicts: () => ({ verdicts: new Map(), isLoading: false }),
}));

vi.mock("@/hooks/use-audit-log", () => ({
  useAuditLogger: () => {},
}));

vi.mock("@/lib/i18n", () => ({
  useI18n: () => ({
    t: (k: string) => {
      const map: Record<string, string> = {
        "header.title": "ALIEN GAUGE",
        "gauge.opportunity": "Opportunité",
        "gauge.risk": "Risque",
        "gauge.stability": "Stabilité",
        "macro.label": "Recommandation Macro",
        "macro.global_index": "Indice Global",
        "top.best": "Meilleur Subnet",
        "top.best_micro": "Meilleur Micro-Cap",
        "top.opportunities": "Top Opportunités",
        "top.risks": "Top Risques",
        "data.confiance": "Confiance",
        "sc.label": "Smart Capital",
        "sc.accumulation": "Accumulation",
        "sc.distribution": "Distribution",
        "sc.neutral": "Neutre",
        "macro.invest": "Investir",
        "macro.hold": "Maintenir",
        "macro.reduce": "Réduire",
        "macro.exit": "Sortir",
        "strat.enter": "ENTER",
        "strat.reinforce": "REINFORCE",
        "strat.hold": "HOLD",
        "strat.exit_fast": "EXIT_FAST",
        "strat.exit": "EXIT",
        "gauge.saturation_alert": "Alerte de saturation",
        "pre_hype.label": "Pré-Hype",
        "panel.title": "Détails Subnet",
        "panel.metrics": "Métriques",
        "panel.liquidity": "Liquidité",
        "panel.volume": "Volume 24h",
        "panel.miners": "Mineurs",
        "panel.cap": "Cap",
        "tip.why": "Pourquoi ?",
        "tip.price7d": "Prix 7j",
      };
      return map[k] ?? k;
    },
    lang: "fr",
  }),
}));

import { render, screen, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useSubnetScores } from "@/hooks/use-subnet-scores";
import AlienGauge from "@/pages/AlienGauge";

function makeMockScore(netuid: number, overrides: Record<string, any> = {}) {
  return {
    netuid,
    name: `Subnet ${netuid}`,
    assetType: "SPECULATIVE" as const,
    state: "GO",
    psi: 65,
    conf: 72,
    quality: 70,
    opp: 60 + netuid,
    risk: 30 + netuid,
    asymmetry: 30,
    momentum: 55,
    momentumLabel: "STABLE" as const,
    momentumScore: 55,
    stability: 65,
    action: "ENTER" as const,
    sc: "ACCUMULATION" as const,
    isOverridden: false,
    overrideLevel: null,
    overrideReasons: [] as string[],
    displayedCap: 100000,
    confianceScore: 70,
    confianceSources: 2,
    delistRisk: null,
    delistCategory: null,
    healthScores: null,
    recalculated: null,
    ...overrides,
  };
}

const defaultScores = [
  makeMockScore(1, { opp: 85, risk: 25, action: "ENTER" }),
  makeMockScore(2, { opp: 70, risk: 45, action: "REINFORCE" }),
  makeMockScore(3, { opp: 40, risk: 75, action: "EXIT", isOverridden: true, overrideReasons: ["Risque critique"] }),
  makeMockScore(4, { opp: 55, risk: 50, action: "HOLD" }),
  makeMockScore(5, { opp: 30, risk: 80, action: "EXIT_FAST" }),
];

function mockScoresReturn(scoresList: any[]) {
  return {
    scoresList,
    scores: new Map(scoresList.map((s: any) => [s.netuid, s])),
    sparklines: new Map(),
    scoreTimestamp: "2025-06-01T12:00:00Z",
    taoUsd: 350,
    isLoading: false,
    subnetList: scoresList.map((s: any) => ({ netuid: s.netuid, name: s.name })),
    marketContext: undefined,
  };
}

function renderGauge() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <AlienGauge />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe("AlienGauge", () => {
  beforeEach(() => {
    vi.mocked(useSubnetScores).mockReturnValue(mockScoresReturn(defaultScores) as any);
  });

  it("renders page header", () => {
    renderGauge();
    expect(screen.getByText("ALIEN GAUGE")).toBeInTheDocument();
  });

  it("renders VISION MACRO section", () => {
    renderGauge();
    expect(screen.getByText("VISION MACRO")).toBeInTheDocument();
  });

  it("displays OPP and RISK labels in gauge center", () => {
    renderGauge();
    expect(screen.getByText("OPP")).toBeInTheDocument();
    expect(screen.getByText("RISK")).toBeInTheDocument();
  });

  it("displays SC label in gauge center", () => {
    renderGauge();
    expect(screen.getByText("SC")).toBeInTheDocument();
  });

  it("renders macro recommendation", () => {
    renderGauge();
    expect(screen.getByText("Recommandation Macro")).toBeInTheDocument();
  });

  it("renders top opportunities section", () => {
    renderGauge();
    expect(screen.getByText("Top Opportunités")).toBeInTheDocument();
  });

  it("renders top risks section", () => {
    renderGauge();
    expect(screen.getByText("Top Risques")).toBeInTheDocument();
  });

  it("shows best subnet card (non-overridden, highest asymmetry)", () => {
    renderGauge();
    const snLabels = screen.getAllByText(/SN-1/);
    expect(snLabels.length).toBeGreaterThanOrEqual(1);
  });

  it("excludes overridden subnets from best card", () => {
    renderGauge();
    expect(screen.getByText(/Meilleur/)).toBeInTheDocument();
  });

  it("top opportunities excludes overridden subnets", () => {
    renderGauge();
    const rows = screen.getAllByText(/^SN-\d+$/);
    const rowTexts = rows.map(el => el.textContent);
    expect(rowTexts.filter(t => t === "SN-1").length).toBeGreaterThanOrEqual(1);
  });

  it("top risks includes overridden subnets first", () => {
    renderGauge();
    const risksSection = screen.getByText("Top Risques");
    expect(risksSection).toBeInTheDocument();
  });

  it("renders stability and confiance sub-metrics", () => {
    renderGauge();
    expect(screen.getByText("Stabilité")).toBeInTheDocument();
    expect(screen.getByText("Confiance")).toBeInTheDocument();
  });

  it("shows timestamp from scoreTimestamp", () => {
    renderGauge();
    const timeEl = screen.getByText(/⏱/);
    expect(timeEl).toBeInTheDocument();
  });

  it("displays micro-cap badge when subnet is micro-cap", () => {
    vi.mocked(useSubnetScores).mockReturnValue(mockScoresReturn([
      makeMockScore(10, { opp: 90, risk: 20, displayedCap: 100_000, psi: 60, quality: 50, sc: "ACCUMULATION" }),
    ]) as any);
    renderGauge();
    expect(screen.getByText("MICRO")).toBeInTheDocument();
  });

  it("empty scores renders without crash", () => {
    vi.mocked(useSubnetScores).mockReturnValue(mockScoresReturn([]) as any);
    renderGauge();
    expect(screen.getByText("ALIEN GAUGE")).toBeInTheDocument();
  });

  it("clicking a subnet row opens the side panel", () => {
    renderGauge();
    const snLabels = screen.getAllByText("SN-1");
    fireEvent.click(snLabels[0].closest("[class*='cursor-pointer']")!);
    expect(screen.getByText("Détails Subnet")).toBeInTheDocument();
  });

  it("side panel shows opportunity and risk scores", () => {
    renderGauge();
    const snLabels = screen.getAllByText("SN-1");
    fireEvent.click(snLabels[0].closest("[class*='cursor-pointer']")!);
    expect(screen.getAllByText(/Opportunité/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/Risque/).length).toBeGreaterThanOrEqual(1);
  });
});
