import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { BrowserRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import PortfolioPage from "@/pages/PortfolioPage";

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
  SPECIAL_SUBNETS: { 0: { label: "ROOT", forceStatus: "OK", forceAction: "HOLD", forceRiskMax: 20, isSystem: true } },
  getSubnetScore: (map: any, id: number) => map.get(id),
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

/* ══════════════════════════════════════════════ */
/*      INTERACTION TESTS: Add position flow       */
/* ══════════════════════════════════════════════ */
describe("PortfolioPage — Add position interactions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPositions = [];
  });

  it("add modal shows quantity input", () => {
    renderPage();
    fireEvent.click(screen.getByText(/Ajouter un subnet/));
    const input = screen.getByDisplayValue("10"); // default qty
    expect(input).toBeInTheDocument();
  });

  it("changing quantity updates input", () => {
    renderPage();
    fireEvent.click(screen.getByText(/Ajouter un subnet/));
    const input = screen.getByDisplayValue("10") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "50" } });
    expect(input.value).toBe("50");
  });

  it("clicking AJOUTER calls addPosition", () => {
    renderPage();
    fireEvent.click(screen.getByText(/Ajouter un subnet/));
    fireEvent.click(screen.getByText("AJOUTER"));
    expect(mockAddPosition).toHaveBeenCalledTimes(1);
  });

  it("modal closes after adding", () => {
    renderPage();
    fireEvent.click(screen.getByText(/Ajouter un subnet/));
    fireEvent.click(screen.getByText("AJOUTER"));
    expect(screen.queryByText("AJOUTER AU PORTEFEUILLE")).not.toBeInTheDocument();
  });

  it("modal shows consensus price preview", () => {
    renderPage();
    fireEvent.click(screen.getByText(/Ajouter un subnet/));
    expect(screen.getByText(/Prix consensus|Consensus price/)).toBeInTheDocument();
  });

  it("modal shows estimated value preview", () => {
    renderPage();
    fireEvent.click(screen.getByText(/Ajouter un subnet/));
    const matches = screen.getAllByText(/Valeur estimée|Est. value/);
    expect(matches.length).toBeGreaterThanOrEqual(2); // summary card + modal
  });

  it("add button disabled with zero quantity", () => {
    renderPage();
    fireEvent.click(screen.getByText(/Ajouter un subnet/));
    const input = screen.getByDisplayValue("10") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "0" } });
    const addBtn = screen.getByText("AJOUTER");
    // Button should be disabled
    fireEvent.click(addBtn);
    expect(mockAddPosition).not.toHaveBeenCalled();
  });
});

/* ══════════════════════════════════════════════ */
/*      INTERACTION TESTS: Position management     */
/* ══════════════════════════════════════════════ */
describe("PortfolioPage — Position management", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("sell button is visible for each position", () => {
    mockPositions = [
      { subnet_id: 1, quantity_tao: 50, entry_price: 0.04, timestamp_added: "2026-01-01" },
    ];
    renderPage();
    expect(screen.getByText("VENDRE")).toBeInTheDocument();
  });

  it("clicking VENDRE calls sellPosition", () => {
    mockPositions = [
      { subnet_id: 1, quantity_tao: 50, entry_price: 0.04, timestamp_added: "2026-01-01" },
    ];
    renderPage();
    fireEvent.click(screen.getByText("VENDRE"));
    expect(mockSellPosition).toHaveBeenCalledWith(1, 0.05); // price from mock scores
  });

  it("remove button (✕) is visible for each position", () => {
    mockPositions = [
      { subnet_id: 1, quantity_tao: 50, entry_price: 0.04, timestamp_added: "2026-01-01" },
    ];
    renderPage();
    expect(screen.getByText("✕")).toBeInTheDocument();
  });

  it("shows RENFORCER action for owned subnets (not ENTRER)", () => {
    mockPositions = [
      { subnet_id: 1, quantity_tao: 50, entry_price: 0.04, timestamp_added: "2026-01-01" },
    ];
    renderPage();
    // Alpha has action ENTER → becomes REINFORCE for owned
    expect(screen.getByText("RENFORCER")).toBeInTheDocument();
  });

  it("shows SORTIR action for EXIT subnets", () => {
    mockPositions = [
      { subnet_id: 6, quantity_tao: 20, entry_price: 0.002, timestamp_added: "2026-01-01" },
    ];
    renderPage();
    expect(screen.getByText("SORTIR")).toBeInTheDocument();
  });

  it("shows OVERRIDE badge for critical subnets", () => {
    mockPositions = [
      { subnet_id: 6, quantity_tao: 20, entry_price: 0.002, timestamp_added: "2026-01-01" },
    ];
    renderPage();
    expect(screen.getByText("OVERRIDE")).toBeInTheDocument();
  });

  it("multiple positions show multiple sell buttons", () => {
    mockPositions = [
      { subnet_id: 1, quantity_tao: 50, entry_price: 0.04, timestamp_added: "2026-01-01" },
      { subnet_id: 6, quantity_tao: 20, entry_price: 0.002, timestamp_added: "2026-01-01" },
    ];
    renderPage();
    const sellButtons = screen.getAllByText("VENDRE");
    expect(sellButtons).toHaveLength(2);
  });

  it("summary cards update with position data", () => {
    mockPositions = [
      { subnet_id: 1, quantity_tao: 100, entry_price: 0.04, timestamp_added: "2026-01-01" },
    ];
    renderPage();
    // Should show 100.00 τ in Total TAO
    expect(screen.getByText("100.00 τ")).toBeInTheDocument();
  });

  it("shows already-owned warning in add modal for existing positions", () => {
    mockPositions = [
      { subnet_id: 1, quantity_tao: 50, entry_price: 0.04, timestamp_added: "2026-01-01" },
    ];
    renderPage();
    fireEvent.click(screen.getByText(/Ajouter un subnet/));
    // Since netuid 1 is owned and is the default selection
    expect(screen.getByText(/Déjà possédé/)).toBeInTheDocument();
  });
});
