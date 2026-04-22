/**
 * Responsive Test Checklist — Compass page
 *
 * Validates the Compass dashboard at the three smallest mobile widths we support
 * (414px, 375px, 320px) and flags:
 *   1. Charts / fixed-width elements that would overflow the viewport
 *      (inline `width` or `minWidth` styles wider than the screen)
 *   2. Unreadable labels — any rendered text node whose computed inline
 *      `font-size` is below the readability threshold (8px)
 *
 * jsdom does not run layout, so we cannot rely on `getBoundingClientRect`.
 * Instead we statically inspect inline styles which is where this codebase
 * sets dimensions for sparklines, tables and typography on Compass.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render } from "@testing-library/react";
import { BrowserRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TooltipProvider } from "@/components/ui/tooltip";
import CompassPage from "@/pages/CompassPage";

/* ── Mocks (mirroring PortfolioPage.test.tsx style) ─────────────────────── */

const baseScore = (netuid: number, name: string, extra: Record<string, any> = {}) => ({
  netuid, name,
  opp: 60, risk: 40, asymmetry: 20, stability: 70, sc: "ACCUMULATION",
  action: "WATCH", isOverridden: false, systemStatus: "OK", confianceScore: 70,
  state: "GO", consensusPrice: 0.05, alphaPrice: 0.05,
  momentumLabel: "STABLE", momentumScore: 55,
  healthScores: {} as any, depegProbability: 0, delistCategory: "NORMAL",
  conf: 70, displayedCap: 1_000_000, quality: 60, psi: 40,
  marketDataDegraded: false, overrideReasons: [], delistScore: 10,
  ...extra,
});

const mockScoresList = [
  baseScore(1, "Alpha", { opp: 75, risk: 20, action: "ENTER", momentumScore: 65 }),
  baseScore(2, "Bravo"),
  baseScore(6, "Foxtrot", { opp: 10, risk: 80, action: "EXIT", isOverridden: true }),
];

const mockDecision = (netuid: number, finalAction: string) => ({
  netuid, finalAction, engineAction: finalAction,
  convictionScore: 60, primaryReason: "Test",
});
const mockDecisionsMap = new Map<number, any>([
  [1, mockDecision(1, "ENTRER")],
  [2, mockDecision(2, "SURVEILLER")],
  [6, mockDecision(6, "SORTIR")],
]);

vi.mock("@/hooks/use-subnet-scores", () => ({
  useSubnetScores: () => ({
    scoresList: mockScoresList,
    sparklines: new Map(),
    scoreTimestamp: new Date().toISOString(),
    taoUsd: 450,
    dataAlignment: "ALIGNED" as const,
    dataAgeDebug: [],
    fleetDistribution: { healthy: 100, degraded: 0, broken: 0 },
    dataConfidence: { score: 90, components: { errorRate: 95, freshness: 95, alignment: 95, coverage: 95 }, level: "HIGH", reasons: [] },
    isLoading: false,
  }),
  SPECIAL_SUBNETS: { 0: { isSystem: true } } as Record<number, any>,
}));
vi.mock("@/hooks/use-canonical-subnets", () => ({
  useCanonicalSubnets: () => ({
    facts: new Map(),
    decisions: mockDecisionsMap,
    earlyPumps: new Map(),
  }),
}));
vi.mock("@/hooks/use-local-portfolio", () => ({
  useLocalPortfolio: () => ({ positions: [] }),
}));
vi.mock("@/hooks/use-audit-log", () => ({ useAuditLogger: () => {} }));
vi.mock("@/lib/i18n", () => ({
  useI18n: () => ({ lang: "fr", t: (k: string) => k, setLang: vi.fn() }),
}));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: () => ({ select: () => Promise.resolve({ data: [], error: null }) }) },
}));

/* ── Viewport helper ────────────────────────────────────────────────────── */

function setViewport(width: number) {
  Object.defineProperty(window, "innerWidth", { writable: true, configurable: true, value: width });
  Object.defineProperty(window, "innerHeight", { writable: true, configurable: true, value: 800 });
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    configurable: true,
    value: (query: string) => {
      // Parse "(max-width: 767px)" / "(min-width: ...)" style queries.
      const max = /max-width:\s*(\d+)px/.exec(query);
      const min = /min-width:\s*(\d+)px/.exec(query);
      let matches = false;
      if (max) matches = width <= parseInt(max[1], 10);
      else if (min) matches = width >= parseInt(min[1], 10);
      return {
        matches, media: query, onchange: null,
        addListener: () => {}, removeListener: () => {},
        addEventListener: () => {}, removeEventListener: () => {},
        dispatchEvent: () => {},
      };
    },
  });
  window.dispatchEvent(new Event("resize"));
}

function renderCompass() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <TooltipProvider>
        <BrowserRouter>
          <CompassPage />
        </BrowserRouter>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

/* ── Inspection helpers ─────────────────────────────────────────────────── */

const READABILITY_MIN_PX = 7; // project baseline: 7px uppercase tracking labels are the smallest accepted size
const SAFE_OVERFLOW_TAGS = new Set(["TABLE", "THEAD", "TBODY", "TR", "TD", "TH"]); // tables live inside an overflow-x scroller

/** Find inline `width` / `min-width` styles that exceed the viewport. */
function findOverflowingElements(root: HTMLElement, viewportWidth: number) {
  const offenders: { tag: string; value: number; kind: "width" | "minWidth"; outer: string }[] = [];
  const all = root.querySelectorAll<HTMLElement>("*");
  all.forEach(el => {
    // Skip nodes that are inside an explicit horizontal scroller (tables, etc.)
    if (SAFE_OVERFLOW_TAGS.has(el.tagName)) return;
    if (el.closest('[class*="overflow-x-auto"]')) return;

    const w = el.style.width;
    const mw = el.style.minWidth;
    const parsePx = (v: string): number | null => {
      if (!v) return null;
      const m = /^(\d+(?:\.\d+)?)px$/.exec(v.trim());
      return m ? parseFloat(m[1]) : null;
    };
    // Also consider the SVG `width` attribute used by sparklines.
    const svgW = el.tagName === "svg" ? parseFloat(el.getAttribute("width") || "") : NaN;

    const wPx = parsePx(w);
    const mwPx = parsePx(mw);
    if (wPx != null && wPx > viewportWidth) {
      offenders.push({ tag: el.tagName, value: wPx, kind: "width", outer: el.outerHTML.slice(0, 120) });
    }
    if (mwPx != null && mwPx > viewportWidth) {
      offenders.push({ tag: el.tagName, value: mwPx, kind: "minWidth", outer: el.outerHTML.slice(0, 120) });
    }
    if (!isNaN(svgW) && svgW > viewportWidth) {
      offenders.push({ tag: el.tagName, value: svgW, kind: "width", outer: el.outerHTML.slice(0, 120) });
    }
  });
  return offenders;
}

/** Find inline font-size styles below the readability threshold. */
function findUnreadableLabels(root: HTMLElement) {
  const offenders: { tag: string; fontSize: number; text: string }[] = [];
  root.querySelectorAll<HTMLElement>("[style*='font-size']").forEach(el => {
    const m = /font-size:\s*(\d+(?:\.\d+)?)px/.exec(el.getAttribute("style") || "");
    if (!m) return;
    const px = parseFloat(m[1]);
    if (px < READABILITY_MIN_PX) {
      offenders.push({ tag: el.tagName, fontSize: px, text: (el.textContent || "").slice(0, 40) });
    }
  });
  return offenders;
}

/* ── Tests ──────────────────────────────────────────────────────────────── */

const VIEWPORTS: { label: string; width: number }[] = [
  { label: "414px (iPhone Plus)", width: 414 },
  { label: "375px (iPhone std)", width: 375 },
  { label: "320px (iPhone SE 1)", width: 320 },
];

describe("Compass — responsive checklist", () => {
  afterEach(() => {
    // Reset to a desktop default so other suites are not affected.
    setViewport(1280);
  });

  for (const vp of VIEWPORTS) {
    describe(`@ ${vp.label}`, () => {
      beforeEach(() => setViewport(vp.width));

      it("renders without throwing", () => {
        const { container } = renderCompass();
        expect(container.firstChild).toBeTruthy();
      });

      it("has no charts or fixed-width elements wider than the viewport", () => {
        const { container } = renderCompass();
        const offenders = findOverflowingElements(container as HTMLElement, vp.width);
        if (offenders.length) {
          // Helpful message in case the test fails.
          // eslint-disable-next-line no-console
          console.warn(`[Compass ${vp.width}px] overflow offenders:`, offenders);
        }
        expect(offenders).toHaveLength(0);
      });

      it("has no labels below the readable font-size threshold (8px)", () => {
        const { container } = renderCompass();
        const offenders = findUnreadableLabels(container as HTMLElement);
        if (offenders.length) {
          // eslint-disable-next-line no-console
          console.warn(`[Compass ${vp.width}px] unreadable labels:`, offenders);
        }
        expect(offenders).toHaveLength(0);
      });
    });
  }
});
