import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import DataAlignmentBadge from "@/components/DataAlignmentBadge";

const mockDebug = [
  { source: "supabase:signals", ageSeconds: 300 },
  { source: "taostats:metrics", ageSeconds: 450 },
];

describe("DataAlignmentBadge", () => {
  it("renders nothing when ALIGNED", () => {
    const { container } = render(
      <DataAlignmentBadge dataAlignment="ALIGNED" dataAgeDebug={mockDebug} />
    );
    expect(container.innerHTML).toBe("");
  });

  it("renders nothing when dataAlignment is undefined", () => {
    const { container } = render(
      <DataAlignmentBadge dataAlignment={undefined as any} dataAgeDebug={undefined as any} />
    );
    expect(container.innerHTML).toBe("");
  });

  it("renders ⏳ DEGRADED badge", () => {
    render(<DataAlignmentBadge dataAlignment="DEGRADED" dataAgeDebug={mockDebug} />);
    expect(screen.getByText("⏳ DEGRADED")).toBeInTheDocument();
  });

  it("renders ⚠ STALE badge", () => {
    render(<DataAlignmentBadge dataAlignment="STALE" dataAgeDebug={mockDebug} />);
    expect(screen.getByText("⚠ STALE")).toBeInTheDocument();
  });

  it("STALE badge has red styling", () => {
    render(<DataAlignmentBadge dataAlignment="STALE" dataAgeDebug={mockDebug} />);
    const badge = screen.getByText("⚠ STALE");
    expect(badge.style.color).toContain("229");
  });

  it("DEGRADED badge has amber styling", () => {
    render(<DataAlignmentBadge dataAlignment="DEGRADED" dataAgeDebug={mockDebug} />);
    const badge = screen.getByText("⏳ DEGRADED");
    expect(badge.style.color).toContain("255");
  });

  it("title contains source ages", () => {
    render(<DataAlignmentBadge dataAlignment="STALE" dataAgeDebug={mockDebug} />);
    const badge = screen.getByText("⚠ STALE");
    expect(badge.title).toContain("supabase:signals: 300s");
    expect(badge.title).toContain("taostats:metrics: 450s");
  });

  it("handles empty dataAgeDebug gracefully", () => {
    render(<DataAlignmentBadge dataAlignment="STALE" dataAgeDebug={[]} />);
    expect(screen.getByText("⚠ STALE")).toBeInTheDocument();
  });

  it("applies custom className", () => {
    render(<DataAlignmentBadge dataAlignment="STALE" dataAgeDebug={mockDebug} className="text-[7px]" />);
    const badge = screen.getByText("⚠ STALE");
    expect(badge.className).toContain("text-[7px]");
  });

  it("has animate-pulse class", () => {
    render(<DataAlignmentBadge dataAlignment="DEGRADED" dataAgeDebug={mockDebug} />);
    const badge = screen.getByText("⏳ DEGRADED");
    expect(badge.className).toContain("animate-pulse");
  });
});
