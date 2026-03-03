import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, act } from "@testing-library/react";

// Mock useIsMobile
let mockIsMobile = false;
vi.mock("@/hooks/use-mobile", () => ({
  useIsMobile: () => mockIsMobile,
}));

vi.mock("@/lib/i18n", () => ({
  useI18n: () => ({ lang: "fr", t: (k: string) => k, setLang: vi.fn() }),
}));

import SwipeHint from "@/components/SwipeHint";

describe("SwipeHint", () => {
  beforeEach(() => {
    mockIsMobile = false;
    sessionStorage.clear();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders nothing on desktop", () => {
    mockIsMobile = false;
    const { container } = render(<SwipeHint storageKey="test-hint" />);
    expect(container.firstChild).toBeNull();
  });

  it("renders hint on mobile", () => {
    mockIsMobile = true;
    render(<SwipeHint storageKey="test-hint" />);
    expect(screen.getByText("Swipez pour voir plus")).toBeInTheDocument();
  });

  it("disappears after 3 seconds", () => {
    mockIsMobile = true;
    render(<SwipeHint storageKey="test-hint" />);
    expect(screen.getByText("Swipez pour voir plus")).toBeInTheDocument();
    act(() => { vi.advanceTimersByTime(3000); });
    expect(screen.queryByText("Swipez pour voir plus")).not.toBeInTheDocument();
  });

  it("sets sessionStorage after timeout", () => {
    mockIsMobile = true;
    render(<SwipeHint storageKey="test-key-123" />);
    act(() => { vi.advanceTimersByTime(3000); });
    expect(sessionStorage.getItem("test-key-123")).toBe("1");
  });

  it("does not show if sessionStorage key already set", () => {
    mockIsMobile = true;
    sessionStorage.setItem("test-hint", "1");
    const { container } = render(<SwipeHint storageKey="test-hint" />);
    expect(container.firstChild).toBeNull();
  });

  it("uses unique storageKey per instance", () => {
    mockIsMobile = true;
    sessionStorage.setItem("page-a", "1");
    const { container: a } = render(<SwipeHint storageKey="page-a" />);
    expect(a.firstChild).toBeNull();
    render(<SwipeHint storageKey="page-b" />);
    expect(screen.getByText("Swipez pour voir plus")).toBeInTheDocument();
  });
});
