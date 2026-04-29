/**
 * Responsive Test Checklist — Compass page (LOADING state)
 *
 * Mirrors `CompassResponsive.test.tsx` but forces the data hook into its
 * `isLoading: true` branch so we render the `PageLoadingState` skeleton
 * instead of the dashboard. Validates that even the loading view:
 *   1. Has no fixed-width elements wider than the viewport (414/375/320 px)
 *   2. Has no labels below the readability threshold (7px)
 *
 * jsdom doesn't run layout, so we statically inspect inline `style.width`,
 * `style.minWidth`, SVG `width` attributes and inline `font-size` declarations.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render } from "@testing-library/react";
import { BrowserRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TooltipProvider } from "@/components/ui/tooltip";
import CompassPage from "@/pages/CompassPage";

/* ── Mocks: force loading state ────────────────────────────────────────── */

vi.mock("@/hooks/use-subnet-scores", () => ({
  useSubnetScores: () => ({
    scoresList: [],
    sparklines: new Map(),
    scoreTimestamp: new Date().toISOString(),
    taoUsd: null,
    dataAlignment: "ALIGNED" as const,
    dataAgeDebug: [],
    fleetDistribution: { healthy: 0, degraded: 0, broken: 0 },
    dataConfidence: { score: 0, components: { errorRate: 0, freshness: 0, alignment: 0, coverage: 0 }, level: "LOW", reasons: [] },
    isLoading: true,
  }),
  SPECIAL_SUBNETS: { 0: { isSystem: true } } as Record<number, any>,
}));
vi.mock("@/hooks/use-canonical-subnets", () => ({
  useCanonicalSubnets: () => ({
    facts: new Map(),
    decisions: new Map(),
    canonicalDecisions: new Map(),
    earlyPumps: new Map(),
    pulses: new Map(),
    dataTrust: {
      level: "OK", globalConfidence: 95, isSafeMode: false, blockEntryActions: false,
      worstSource: null, worstAgeSeconds: 0, lastReliableUpdate: new Date().toISOString(),
      reasons: [], evaluatedAt: new Date().toISOString(),
    },
    decisionsList: [],
    isLoading: true,
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

/* ── Inspection helpers (identical contract to the dashboard test) ─────── */

const READABILITY_MIN_PX = 7;
const SAFE_OVERFLOW_TAGS = new Set(["TABLE", "THEAD", "TBODY", "TR", "TD", "TH"]);

function findOverflowingElements(root: HTMLElement, viewportWidth: number) {
  const offenders: { tag: string; value: number; kind: "width" | "minWidth"; outer: string }[] = [];
  root.querySelectorAll<HTMLElement>("*").forEach(el => {
    if (SAFE_OVERFLOW_TAGS.has(el.tagName)) return;
    if (el.closest('[class*="overflow-x-auto"]')) return;
    const parsePx = (v: string): number | null => {
      if (!v) return null;
      const m = /^(\d+(?:\.\d+)?)px$/.exec(v.trim());
      return m ? parseFloat(m[1]) : null;
    };
    const wPx = parsePx(el.style.width);
    const mwPx = parsePx(el.style.minWidth);
    const svgW = el.tagName === "svg" ? parseFloat(el.getAttribute("width") || "") : NaN;
    if (wPx != null && wPx > viewportWidth) offenders.push({ tag: el.tagName, value: wPx, kind: "width", outer: el.outerHTML.slice(0, 120) });
    if (mwPx != null && mwPx > viewportWidth) offenders.push({ tag: el.tagName, value: mwPx, kind: "minWidth", outer: el.outerHTML.slice(0, 120) });
    if (!isNaN(svgW) && svgW > viewportWidth) offenders.push({ tag: el.tagName, value: svgW, kind: "width", outer: el.outerHTML.slice(0, 120) });
  });
  return offenders;
}

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

describe("Compass — responsive checklist (loading state)", () => {
  afterEach(() => {
    setViewport(1280);
  });

  for (const vp of VIEWPORTS) {
    describe(`@ ${vp.label}`, () => {
      beforeEach(() => setViewport(vp.width));

      it("renders the loading skeleton without throwing", () => {
        const { container } = renderCompass();
        expect(container.firstChild).toBeTruthy();
        // PageLoadingState shows a "Chargement" label by default — assert we are
        // really in the loading branch rather than the dashboard.
        expect(container.textContent || "").toMatch(/chargement/i);
      });

      it("has no fixed-width elements wider than the viewport while loading", () => {
        const { container } = renderCompass();
        const offenders = findOverflowingElements(container as HTMLElement, vp.width);
        if (offenders.length) {
          // eslint-disable-next-line no-console
          console.warn(`[Compass loading ${vp.width}px] overflow offenders:`, offenders);
        }
        expect(offenders).toHaveLength(0);
      });

      it("has no labels below the readable font-size threshold while loading", () => {
        const { container } = renderCompass();
        const offenders = findUnreadableLabels(container as HTMLElement);
        if (offenders.length) {
          // eslint-disable-next-line no-console
          console.warn(`[Compass loading ${vp.width}px] unreadable labels:`, offenders);
        }
        expect(offenders).toHaveLength(0);
      });
    });
  }
});
