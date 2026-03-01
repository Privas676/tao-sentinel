/* ═══════════════════════════════════════ */
/*   SAFE REFACTOR MODE — UI GUARD         */
/* ═══════════════════════════════════════ */

/**
 * When SAFE_REFACTOR_MODE is true, only internal logic changes are allowed.
 * UI components, layouts, routes, colors, and typography must remain identical.
 *
 * This flag is checked by snapshot tests and CI guards.
 */
export const SAFE_REFACTOR_MODE = true;

/**
 * Frozen list of UI page components — renaming or removing any of these
 * while SAFE_REFACTOR_MODE is true will cause CI to fail.
 */
export const FROZEN_UI_PAGES = [
  "AlienGauge",
  "SubnetsPage",
  "AlertsPage",
  "SettingsPage",
  "PortfolioPage",
  "InstallPage",
  "AuthPage",
] as const;

/**
 * Frozen list of routes — adding/removing/renaming routes
 * while SAFE_REFACTOR_MODE is true will cause CI to fail.
 */
export const FROZEN_ROUTES = [
  "/",
  "/subnets",
  "/portfolio",
  "/alerts",
  "/settings",
  "/auth",
  "/install",
] as const;

/**
 * Frozen sidebar nav items count.
 */
export const FROZEN_NAV_COUNT = 6;
