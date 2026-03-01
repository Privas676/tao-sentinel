/**
 * CI Guard — blocks build if UI structure has drifted.
 *
 * This test reads App.tsx source to verify:
 * 1. All frozen routes are present
 * 2. All frozen page imports are present
 * 3. Nav items count matches
 *
 * If any check fails, the test suite fails → CI blocks merge.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import {
  SAFE_REFACTOR_MODE,
  FROZEN_UI_PAGES,
  FROZEN_ROUTES,
  FROZEN_NAV_COUNT,
} from "@/lib/safe-refactor";

const APP_SOURCE = readFileSync(resolve(__dirname, "../App.tsx"), "utf-8");

describe("UI Guard — CI blocker", () => {
  it("SAFE_REFACTOR_MODE is enabled", () => {
    expect(SAFE_REFACTOR_MODE).toBe(true);
  });

  it("all frozen page imports exist in App.tsx", () => {
    for (const page of FROZEN_UI_PAGES) {
      // Check that the page is imported (default or named)
      const importPattern = new RegExp(`import.*${page}.*from`);
      expect(
        importPattern.test(APP_SOURCE),
        `Missing import for frozen page: ${page}`
      ).toBe(true);
    }
  });

  it("all frozen routes are declared in App.tsx", () => {
    for (const route of FROZEN_ROUTES) {
      const routePattern = new RegExp(`path=["']${route.replace("/", "\\/")}["']`);
      expect(
        routePattern.test(APP_SOURCE),
        `Missing route declaration: ${route}`
      ).toBe(true);
    }
  });

  it("nav items count matches frozen count", () => {
    // Count navItems array entries by looking for { path: patterns
    const matches = APP_SOURCE.match(/\{ path: "/g);
    expect(
      matches?.length,
      `Nav items count changed! Expected ${FROZEN_NAV_COUNT}, found ${matches?.length}`
    ).toBe(FROZEN_NAV_COUNT);
  });

  it("no frozen page files have been deleted", async () => {
    const pageFiles = [
      "AlienGauge.tsx",
      "SubnetsPage.tsx",
      "AlertsPage.tsx",
      "SettingsPage.tsx",
      "PortfolioPage.tsx",
      "InstallPage.tsx",
      "AuthPage.tsx",
    ];

    for (const file of pageFiles) {
      let exists = true;
      try {
        readFileSync(resolve(__dirname, `../pages/${file}`), "utf-8");
      } catch {
        exists = false;
      }
      expect(exists, `Frozen page file deleted: ${file}`).toBe(true);
    }
  });
});
