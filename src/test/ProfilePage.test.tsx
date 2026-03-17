import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

// --- Mocks (hoisting-safe: use object refs, not let reassignment) ---

const mockNavigate = vi.fn();
vi.mock("react-router-dom", () => ({
  useNavigate: () => mockNavigate,
}));

const mockToast = { success: vi.fn(), error: vi.fn() };
vi.mock("sonner", () => ({
  toast: mockToast,
}));

const authState = {
  user: { id: "user-123", email: "test@example.com" } as any,
  loading: false,
};
vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({ user: authState.user, loading: authState.loading }),
}));

const mockMaybeSingle = vi.fn();
const mockUpdateEq = vi.fn().mockReturnValue({ error: null });
const mockUpdate = vi.fn().mockReturnValue({ eq: mockUpdateEq });
const mockUpload = vi.fn().mockResolvedValue({ error: null });
const mockGetPublicUrl = vi.fn().mockReturnValue({
  data: { publicUrl: "https://cdn.example.com/avatar.png" },
});

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: mockMaybeSingle,
        }),
      }),
      update: (data: any) => {
        mockUpdate(data);
        return { eq: mockUpdateEq };
      },
    }),
    storage: {
      from: () => ({
        upload: mockUpload,
        getPublicUrl: mockGetPublicUrl,
      }),
    },
  },
}));

import ProfilePage from "@/pages/ProfilePage";

describe("ProfilePage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authState.user = { id: "user-123", email: "test@example.com" };
    authState.loading = false;
    mockMaybeSingle.mockResolvedValue({
      data: { display_name: "Alice", avatar_url: null },
      error: null,
    });
    mockUpload.mockResolvedValue({ error: null });
    mockUpdateEq.mockReturnValue({ error: null });
  });

  it("renders loading state initially", () => {
    authState.loading = true;
    render(<ProfilePage />);
    expect(screen.getByText("Chargement…")).toBeInTheDocument();
  });

  it("redirects to /auth when not authenticated", () => {
    authState.user = null;
    render(<ProfilePage />);
    expect(mockNavigate).toHaveBeenCalledWith("/auth");
  });

  it("renders profile form after loading", async () => {
    render(<ProfilePage />);
    await waitFor(() => {
      expect(screen.getByText("Profil")).toBeInTheDocument();
    });
    expect(screen.getByDisplayValue("Alice")).toBeInTheDocument();
    expect(screen.getByText("test@example.com")).toBeInTheDocument();
  });

  it("shows initials when no avatar", async () => {
    render(<ProfilePage />);
    await waitFor(() => {
      expect(screen.getByText("A")).toBeInTheDocument();
    });
  });

  it("updates display name on save", async () => {
    render(<ProfilePage />);
    await waitFor(() => screen.getByDisplayValue("Alice"));

    fireEvent.change(screen.getByDisplayValue("Alice"), {
      target: { value: "Bob" },
    });
    fireEvent.click(screen.getByText("Enregistrer"));

    await waitFor(() => {
      expect(mockUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ display_name: "Bob" })
      );
      expect(mockToast.success).toHaveBeenCalledWith("Profil mis à jour");
    });
  });

  it("rejects files over 2 MB", async () => {
    render(<ProfilePage />);
    await waitFor(() => screen.getByText("Profil"));

    const file = new File(["x".repeat(3 * 1024 * 1024)], "big.png", {
      type: "image/png",
    });
    const input = document.querySelector(
      'input[type="file"]'
    ) as HTMLInputElement;
    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => {
      expect(mockToast.error).toHaveBeenCalledWith(
        "L'image doit faire moins de 2 Mo"
      );
    });
    expect(mockUpload).not.toHaveBeenCalled();
  });

  it("uploads avatar and updates profile", async () => {
    render(<ProfilePage />);
    await waitFor(() => screen.getByText("Profil"));

    const file = new File(["img"], "photo.jpg", { type: "image/jpeg" });
    const input = document.querySelector(
      'input[type="file"]'
    ) as HTMLInputElement;
    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => {
      expect(mockUpload).toHaveBeenCalledWith("user-123/avatar.jpg", file, {
        upsert: true,
      });
      expect(mockToast.success).toHaveBeenCalledWith("Avatar mis à jour");
    });
  });

  it("shows upload error via toast", async () => {
    mockUpload.mockResolvedValue({
      error: { message: "Upload failed" },
    });
    render(<ProfilePage />);
    await waitFor(() => screen.getByText("Profil"));

    const file = new File(["img"], "photo.png", { type: "image/png" });
    const input = document.querySelector(
      'input[type="file"]'
    ) as HTMLInputElement;
    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => {
      expect(mockToast.error).toHaveBeenCalledWith("Upload failed");
    });
  });

  it("shows avatar image when avatarUrl is set", async () => {
    mockMaybeSingle.mockResolvedValue({
      data: {
        display_name: "Eve",
        avatar_url: "https://cdn.example.com/eve.png",
      },
      error: null,
    });
    render(<ProfilePage />);
    await waitFor(() => {
      const img = screen.getByAltText("Avatar");
      expect(img).toBeInTheDocument();
      expect(img).toHaveAttribute("src", "https://cdn.example.com/eve.png");
    });
  });
});
