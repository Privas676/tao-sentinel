import { describe, it, expect, vi, beforeEach } from "vitest";
// @ts-expect-error -- @testing-library/dom types re-exported at runtime
import { render, screen, fireEvent } from "@testing-library/react";
import { BrowserRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// ── Mock hooks ──
const mockAddPosition = vi.fn();
const mockSellPosition = vi.fn();
let mockPositions: any[] = [];

vi.mock("@/hooks/use-local-portfolio", () => ({
  useLocalPortfolio: () => ({
    positions: mockPositions,
    archive: [],
    ownedNetuids: new Set(mockPositions.map((p: any) => p.subnet_id)),
    isOwned: (n: number) => mockPositions.some((p: any) => p.subnet_id === n),
    addPosition: mockAddPosition,
    removePosition: vi.fn(),
    sellPosition: mockSellPosition,
    updateQuantity: vi.fn(),
  }),
}));

const mockScores = new Map([
  [1, {
    netuid: 1, name: "Alpha", opp: 70, risk: 25, asymmetry: 45, stability: 75,
    sc: "ACCUMULATION", action: "ENTER", isOverridden: false, systemStatus: "OK",
    confianceScore: 80, state: "GO", consensusPrice: 0.05, alphaPrice: 0.05,
    momentumLabel: "FORT",
  }],
  [6, {
    netuid: 6, name: "Bravo", opp: 0, risk: 85, asymmetry: -85, stability: 20,
    sc: "DISTRIBUTION", action: "EXIT", isOverridden: true, systemStatus: "CRITICAL",
    confianceScore: 40, state: "BREAK", consensusPrice: 0.001, alphaPrice: 0.001,
    momentumLabel: "DÉTÉRIORATION",
  }],
]);

vi.mock("@/hooks/use-subnet-scores", () => ({
  useSubnetScores: () => ({
    scores: mockScores,
    scoresList: Array.from(mockScores.values()),
    scoreTimestamp: "2026-03-01T12:00:00Z",
    taoUsd: 450,
    isLoading: false,
    sparklines: new Map(),
    subnetList: [{ netuid: 1, name: "Alpha" }, { netuid: 6, name: "Bravo" }],
    marketContext: new Map(),
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

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const PortfolioPage = require("@/pages/PortfolioPage").default;
  return render(
    <QueryClientProvider client={qc}>
      <BrowserRouter>
        <PortfolioPage />
      </BrowserRouter>
    </QueryClientProvider>
  );
}

describe("PortfolioPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPositions = [];
  });

  it("renders page title", () => {
    renderPage();
    expect(screen.getByText("Portefeuille")).toBeInTheDocument();
  });

  it("shows empty state when no positions", () => {
    renderPage();
    expect(screen.getByText("📊")).toBeInTheDocument();
  });

  it("renders add subnet button", () => {
    renderPage();
    expect(screen.getByText(/Ajouter un subnet/)).toBeInTheDocument();
  });

  it("opens add modal on button click", () => {
    renderPage();
    fireEvent.click(screen.getByText(/Ajouter un subnet/));
    expect(screen.getByText("AJOUTER AU PORTEFEUILLE")).toBeInTheDocument();
  });

  it("add modal has cancel and add buttons", () => {
    renderPage();
    fireEvent.click(screen.getByText(/Ajouter un subnet/));
    expect(screen.getByText("ANNULER")).toBeInTheDocument();
    expect(screen.getByText("AJOUTER")).toBeInTheDocument();
  });

  it("closes modal on cancel", () => {
    renderPage();
    fireEvent.click(screen.getByText(/Ajouter un subnet/));
    fireEvent.click(screen.getByText("ANNULER"));
    expect(screen.queryByText("AJOUTER AU PORTEFEUILLE")).not.toBeInTheDocument();
  });

  it("renders summary cards with positions", () => {
    mockPositions = [
      { subnet_id: 1, quantity_tao: 100, entry_price: 0.04, timestamp_added: "2026-01-01" },
    ];
    renderPage();
    // Summary cards should show Total TAO
    expect(screen.getByText("Total TAO")).toBeInTheDocument();
  });

  it("renders position row with subnet name", () => {
    mockPositions = [
      { subnet_id: 1, quantity_tao: 50, entry_price: 0.04, timestamp_added: "2026-01-01" },
    ];
    renderPage();
    expect(screen.getByText("Alpha")).toBeInTheDocument();
  });

  it("shows score timestamp", () => {
    renderPage();
    expect(screen.getByText(/Scores unifiés/)).toBeInTheDocument();
  });

  it("displays portfolio alerts for overridden positions", () => {
    mockPositions = [
      { subnet_id: 6, quantity_tao: 20, entry_price: 0.002, timestamp_added: "2026-01-01" },
    ];
    renderPage();
    expect(screen.getByText(/ALERTES PORTEFEUILLE/)).toBeInTheDocument();
  });
});
