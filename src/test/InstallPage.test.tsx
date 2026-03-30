import { describe, it, expect, vi, beforeEach, beforeAll } from "vitest";
import React from "react";
import { render, screen } from "@testing-library/react";

vi.mock("@/lib/i18n", () => ({
  useI18n: () => ({
    t: (k: string) => k,
    lang: "fr",
  }),
}));

// Mock window.matchMedia for standalone check
const mockMatchMedia = vi.fn().mockReturnValue({
  matches: false,
  media: "",
  onchange: null,
  addListener: vi.fn(),
  removeListener: vi.fn(),
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
  dispatchEvent: vi.fn(),
});

Object.defineProperty(window, "matchMedia", { writable: true, value: mockMatchMedia });

let InstallPageComponent: React.ComponentType | null = null;

async function loadInstallPage() {
  const mod = await import("@/pages/InstallPage");
  InstallPageComponent = mod.default;
}

function renderInstall() {
  if (!InstallPageComponent) throw new Error("InstallPage not loaded");
  return render(<InstallPageComponent />);
}

describe("InstallPage", () => {
  beforeAll(async () => {
    await loadInstallPage();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mockMatchMedia.mockReturnValue({
      matches: false, media: "", onchange: null,
      addListener: vi.fn(), removeListener: vi.fn(),
      addEventListener: vi.fn(), removeEventListener: vi.fn(), dispatchEvent: vi.fn(),
    });
    // Reset navigator.userAgent
    Object.defineProperty(navigator, "userAgent", { value: "Mozilla/5.0 (Windows NT 10.0; Win64; x64)", configurable: true });
  });

  it("renders Tao Sentinel title", () => {
    renderInstall();
    expect(screen.getByText("Tao Sentinel")).toBeInTheDocument();
  });

  it("shows install description in French", () => {
    renderInstall();
    expect(screen.getByText(/Installez l'app/)).toBeInTheDocument();
  });

  it("renders iOS section with Apple label", () => {
    renderInstall();
    expect(screen.getByText("iPhone / iPad")).toBeInTheDocument();
  });

  it("renders Android section", () => {
    renderInstall();
    expect(screen.getByText("Android")).toBeInTheDocument();
  });

  it("renders iOS install steps", () => {
    renderInstall();
    expect(screen.getByText(/Ouvrir cette page dans Safari/)).toBeInTheDocument();
    expect(screen.getByText(/Appuyer sur le bouton Partager/)).toBeInTheDocument();
    expect(screen.getAllByText(/écran d'accueil/).length).toBeGreaterThan(0);
  });

  it("renders Android install steps", () => {
    renderInstall();
    expect(screen.getByText(/Ouvrir cette page dans Chrome/)).toBeInTheDocument();
    expect(screen.getByText(/menu.*en haut à droite/)).toBeInTheDocument();
  });

  it("renders benefits section", () => {
    renderInstall();
    expect(screen.getByText("Accès instant")).toBeInTheDocument();
    expect(screen.getByText("Mode hors-ligne")).toBeInTheDocument();
    expect(screen.getByText("Notifications")).toBeInTheDocument();
  });

  it("renders PWA description footer", () => {
    renderInstall();
    expect(screen.getByText(/Progressive Web App/)).toBeInTheDocument();
  });

  it("shows standalone message when app is already installed", () => {
    mockMatchMedia.mockReturnValue({
      matches: true, media: "(display-mode: standalone)", onchange: null,
      addListener: vi.fn(), removeListener: vi.fn(),
      addEventListener: vi.fn(), removeEventListener: vi.fn(), dispatchEvent: vi.fn(),
    });
    renderInstall();
    expect(screen.getByText(/Application installée/)).toBeInTheDocument();
  });

  it("shows 'Your device' badge on iOS", () => {
    Object.defineProperty(navigator, "userAgent", { value: "Mozilla/5.0 (iPhone; CPU iPhone OS)", configurable: true });
    renderInstall();
    expect(screen.getByText("Votre appareil")).toBeInTheDocument();
  });

  it("shows 'Your device' badge on Android", () => {
    Object.defineProperty(navigator, "userAgent", { value: "Mozilla/5.0 (Linux; Android 12)", configurable: true });
    renderInstall();
    expect(screen.getByText("Votre appareil")).toBeInTheDocument();
  });

  it("does not show native install button without beforeinstallprompt", () => {
    renderInstall();
    // The page contains instruction text with "Installer l'application" but no native install button
    // Native button would have role="button" with that text
    expect(screen.queryByRole("button", { name: /Installer l'application/ })).toBeNull();
  });
});
