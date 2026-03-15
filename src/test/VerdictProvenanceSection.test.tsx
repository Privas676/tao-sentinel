import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { VerdictProvenanceSection } from "@/components/subnet/ProofSections";
import type { VerdictV3Result } from "@/lib/verdict-engine-v3";

function makeVerdict(overrides: Partial<VerdictV3Result> = {}): VerdictV3Result {
  return {
    netuid: 22,
    name: "Test",
    verdict: "ENTER",
    verdictFr: "ENTRER",
    verdictEn: "ENTER",
    urgency: "LOW",
    confidence: 80,
    conviction: "HIGH",
    horizon: "MOYEN",
    primaryReason: { code: "OPP_HIGH", text: "Opportunity score 85/100", source: "opp" },
    secondaryReasons: [],
    riskFlags: [],
    isBlocked: false,
    blocks: [],
    watchlist: [],
    concordanceGrade: "A",
    concordanceScore: 95,
    prohibitionViolations: [],
    engineVersion: "v3.0",
    portfolioAction: "RENFORCER",
    ...overrides,
  };
}

describe("VerdictProvenanceSection", () => {
  it("renders ENTRER verdict with conviction and confidence", () => {
    render(<VerdictProvenanceSection verdict={makeVerdict()} fr />);
    expect(screen.getByText("ENTRER")).toBeInTheDocument();
    expect(screen.getByText("HIGH")).toBeInTheDocument();
    expect(screen.getByText("80/100")).toBeInTheDocument();
    expect(screen.getByText("RENFORCER")).toBeInTheDocument();
    expect(screen.getByText(/Opportunity score/)).toBeInTheDocument();
  });

  it("renders SORTIR verdict with blocks", () => {
    const v = makeVerdict({
      verdict: "SORTIR",
      verdictFr: "SORTIR",
      verdictEn: "EXIT",
      urgency: "HIGH",
      conviction: "HIGH",
      confidence: 90,
      portfolioAction: "SORTIR",
      primaryReason: { code: "EXIT_RISK", text: "Risk too high", source: "risk" },
      isBlocked: true,
      blocks: [
        { code: "POOL_IMBALANCE", message: "Pool ratio critical", trigger: "amm" },
      ],
    });
    render(<VerdictProvenanceSection verdict={v} fr />);
    expect(screen.getAllByText("SORTIR")).toHaveLength(2); // verdict + portfolio
    expect(screen.getByText("Pool ratio critical")).toBeInTheDocument();
    expect(screen.getByText(/POOL_IMBALANCE/)).toBeInTheDocument();
  });

  it("renders NON_INVESTISSABLE (ÉVITER) verdict with risk flags", () => {
    const v = makeVerdict({
      verdict: "NON_INVESTISSABLE",
      verdictFr: "ÉVITER",
      verdictEn: "AVOID",
      urgency: "CRITICAL",
      conviction: "HIGH",
      confidence: 95,
      portfolioAction: "NE_PAS_ENTRER",
      primaryReason: { code: "DELIST", text: "Delist risk 92%", source: "delist" },
      riskFlags: [
        { code: "DEPEG", text: "Depeg probability 45%", source: "depeg" },
      ],
    });
    render(<VerdictProvenanceSection verdict={v} fr />);
    expect(screen.getByText("ÉVITER")).toBeInTheDocument();
    expect(screen.getByText("NE_PAS_ENTRER")).toBeInTheDocument();
    expect(screen.getByText("CRITICAL")).toBeInTheDocument();
    expect(screen.getByText(/Depeg probability 45%/)).toBeInTheDocument();
  });

  it("renders DONNÉES_INSTABLES (AUCUNE_DECISION) verdict", () => {
    const v = makeVerdict({
      verdict: "DONNÉES_INSTABLES",
      verdictFr: "DONNÉES INSTABLES",
      verdictEn: "UNSTABLE DATA",
      urgency: "MEDIUM",
      conviction: "NONE",
      confidence: 20,
      portfolioAction: "CONSERVER",
      primaryReason: { code: "DATA_GAP", text: "Missing metrics for 4h", source: "data" },
      watchlist: ["Wait for data refresh", "Monitor pool depth"],
    });
    render(<VerdictProvenanceSection verdict={v} fr />);
    expect(screen.getByText("DONNÉES INSTABLES")).toBeInTheDocument();
    expect(screen.getByText("NONE")).toBeInTheDocument();
    expect(screen.getByText("20/100")).toBeInTheDocument();
    expect(screen.getByText("CONSERVER")).toBeInTheDocument();
    expect(screen.getByText(/Wait for data refresh/)).toBeInTheDocument();
    expect(screen.getByText(/Monitor pool depth/)).toBeInTheDocument();
  });

  it("renders secondary reasons when present", () => {
    const v = makeVerdict({
      secondaryReasons: [
        { code: "MKT_OK", text: "Market solid 80/100", source: "market" },
        { code: "EXEC_OK", text: "Execution good 85/100", source: "exec" },
      ],
    });
    render(<VerdictProvenanceSection verdict={v} fr />);
    expect(screen.getByText(/Market solid/)).toBeInTheDocument();
    expect(screen.getByText(/Execution good/)).toBeInTheDocument();
  });

  it("renders prohibition violations when present", () => {
    const v = makeVerdict({
      prohibitionViolations: [
        { code: "P_RISK_CAP", scoreCapped: "risk", originalValue: 10, cappedValue: 25 },
      ],
    });
    render(<VerdictProvenanceSection verdict={v} fr />);
    expect(screen.getByText(/P_RISK_CAP/)).toBeInTheDocument();
  });

  it("renders engine provenance footer", () => {
    render(<VerdictProvenanceSection verdict={makeVerdict()} fr={false} />);
    expect(screen.getByText(/Engine: v3.0/)).toBeInTheDocument();
    expect(screen.getByText(/Concordance: A/)).toBeInTheDocument();
  });
});
