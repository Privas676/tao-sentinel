import { describe, it, expect, vi, beforeEach } from "vitest";

const mockSetLang = vi.fn();
const mockSetMode = vi.fn();
const mockSetDelistMode = vi.fn();

let currentLang = "fr";
let currentMode = "strict";
let currentDelistMode = "manual";

vi.mock("@/lib/i18n", () => ({
  useI18n: () => ({
    t: (k: string) => k,
    lang: currentLang,
    setLang: mockSetLang,
  }),
}));

vi.mock("@/hooks/use-override-mode", () => ({
  useOverrideMode: () => ({
    mode: currentMode,
    setMode: mockSetMode,
  }),
}));

vi.mock("@/hooks/use-delist-mode", () => ({
  useDelistMode: () => ({
    delistMode: currentDelistMode,
    setDelistMode: mockSetDelistMode,
  }),
}));

vi.mock("@/hooks/use-push-notifications", () => ({
  usePushNotifications: () => ({
    state: "unsubscribed",
    error: null,
    testResult: null,
    subscribe: vi.fn(),
    unsubscribe: vi.fn(),
    sendTest: vi.fn(),
    detectState: vi.fn(),
  }),
}));

import { render, screen, fireEvent } from "@testing-library/react";
import SettingsPage from "@/pages/SettingsPage";

function renderSettings() {
  return render(<SettingsPage />);
}

describe("SettingsPage", () => {
  beforeEach(() => {
    currentLang = "fr";
    currentMode = "strict";
    currentDelistMode = "manual";
    vi.clearAllMocks();
  });

  it("renders page title", () => {
    renderSettings();
    expect(screen.getByText("Réglages")).toBeInTheDocument();
  });

  it("renders language options", () => {
    renderSettings();
    expect(screen.getByText("Français")).toBeInTheDocument();
    expect(screen.getByText("English")).toBeInTheDocument();
  });

  it("clicking English calls setLang('en')", () => {
    renderSettings();
    fireEvent.click(screen.getByText("English"));
    expect(mockSetLang).toHaveBeenCalledWith("en");
  });

  it("clicking Français calls setLang('fr')", () => {
    renderSettings();
    fireEvent.click(screen.getByText("Français"));
    expect(mockSetLang).toHaveBeenCalledWith("fr");
  });

  it("renders delist detection options", () => {
    renderSettings();
    expect(screen.getByText("📋 Manuel")).toBeInTheDocument();
    expect(screen.getByText("🤖 Auto")).toBeInTheDocument();
  });

  it("clicking auto delist calls setDelistMode", () => {
    renderSettings();
    fireEvent.click(screen.getByText("🤖 Auto"));
    expect(mockSetDelistMode).toHaveBeenCalledWith("auto_taostats");
  });

  it("clicking manual delist calls setDelistMode", () => {
    renderSettings();
    fireEvent.click(screen.getByText("📋 Manuel"));
    expect(mockSetDelistMode).toHaveBeenCalledWith("manual");
  });

  it("renders override mode options", () => {
    renderSettings();
    expect(screen.getByText("🛡 Strict")).toBeInTheDocument();
    expect(screen.getByText("⚡ Permissif")).toBeInTheDocument();
  });

  it("clicking permissive calls setMode('permissive')", () => {
    renderSettings();
    fireEvent.click(screen.getByText("⚡ Permissif"));
    expect(mockSetMode).toHaveBeenCalledWith("permissive");
  });

  it("clicking strict calls setMode('strict')", () => {
    renderSettings();
    fireEvent.click(screen.getByText("🛡 Strict"));
    expect(mockSetMode).toHaveBeenCalledWith("strict");
  });

  it("shows strict mode description when strict is active", () => {
    renderSettings();
    expect(screen.getByText(/Risk ≥ 70/)).toBeInTheDocument();
  });

  it("shows permissive description when permissive is active", () => {
    currentMode = "permissive";
    renderSettings();
    expect(screen.getByText(/Toutes les alertes override/)).toBeInTheDocument();
  });

  it("renders refresh interval display", () => {
    renderSettings();
    expect(screen.getByText("Signals: 60s")).toBeInTheDocument();
    expect(screen.getByText("Sparklines: 300s")).toBeInTheDocument();
  });

  it("renders threshold table", () => {
    renderSettings();
    expect(screen.getByText("PSI 35–55")).toBeInTheDocument();
    expect(screen.getByText("PSI 55–70")).toBeInTheDocument();
    expect(screen.getByText("PSI 70–85")).toBeInTheDocument();
    expect(screen.getByText(/PSI > 85/)).toBeInTheDocument();
    expect(screen.getByText(/Risk > 70/)).toBeInTheDocument();
  });
});
