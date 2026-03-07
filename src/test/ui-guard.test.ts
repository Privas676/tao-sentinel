/**
 * CI Guard — blocks build if UI structure has drifted.
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
const SHELL_SOURCE = readFileSync(resolve(__dirname, "../components/AppShell.tsx"), "utf-8");

describe("UI Guard — CI blocker", () => {
  it("SAFE_REFACTOR_MODE is enabled", () => {
    expect(SAFE_REFACTOR_MODE).toBe(true);
  });

  it("all frozen page imports exist in App.tsx", () => {
    for (const page of FROZEN_UI_PAGES) {
      const importPattern = new RegExp(`import.*${page}.*from`);
      expect(
        importPattern.test(APP_SOURCE),
        `Missing import for frozen page: ${page}`
      ).toBe(true);
    }
  });

  it("all frozen routes are declared in App.tsx", () => {
    for (const route of FROZEN_ROUTES) {
      const routePattern = new RegExp(`path=["']${route.replace(/\//g, "\\/")}["']`);
      expect(
        routePattern.test(APP_SOURCE),
        `Missing route declaration: ${route}`
      ).toBe(true);
    }
  });

  it("nav items count matches frozen count", () => {
    const matches = SHELL_SOURCE.match(/\{ path: "/g);
    expect(
      matches?.length,
      `Nav items count changed! Expected ${FROZEN_NAV_COUNT}, found ${matches?.length}`
    ).toBe(FROZEN_NAV_COUNT);
  });

  it("no frozen page files have been deleted", async () => {
    const pageFiles = [
      "CompassPage.tsx",
      "SubnetsPage.tsx",
      "SubnetDetailPage.tsx",
      "PortfolioPage.tsx",
      "AlertsPage.tsx",
      "SettingsPage.tsx",
      "LabPage.tsx",
      "AuthPage.tsx",
      "InstallPage.tsx",
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
