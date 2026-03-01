import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

// --- Mocks ---

const mockNavigate = vi.fn();
vi.mock("react-router-dom", () => ({
  useNavigate: () => mockNavigate,
}));

const mockToastSuccess = vi.fn();
const mockToastError = vi.fn();
vi.mock("sonner", () => ({
  toast: { success: mockToastSuccess, error: mockToastError },
}));

let mockUser: any = { id: "user-123", email: "test@example.com" };
let mockAuthLoading = false;
vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({ user: mockUser, loading: mockAuthLoading }),
}));

const mockUpdate = vi.fn();
const mockUpload = vi.fn();
const mockGetPublicUrl = vi.fn();
const mockSelect = vi.fn();

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) => ({
      select: (cols: string) => ({
        eq: (_col: string, _val: string) => ({
          maybeSingle: mockSelect,
        }),
      }),
      update: (data: any) => {
        mockUpdate(data);
        return {
          eq: () => ({ error: null }),
        };
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

// --- Helpers ---

function renderProfile() {
  return render(<ProfilePage />);
}

// Import after mocks
import ProfilePage from "@/pages/ProfilePage";

describe("ProfilePage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUser = { id: "user-123", email: "test@example.com" };
    mockAuthLoading = false;
    mockSelect.mockResolvedValue({
      data: { display_name: "Alice", avatar_url: null },
      error: null,
    });
    mockUpload.mockResolvedValue({ error: null });
    mockGetPublicUrl.mockReturnValue({
      data: { publicUrl: "https://cdn.example.com/avatar.png" },
    });
  });

  it("renders loading state initially", () => {
    mockAuthLoading = true;
    renderProfile();
    expect(screen.getByText("Chargement…")).toBeInTheDocument();
  });

  it("redirects to /auth when not authenticated", () => {
    mockUser = null;
    renderProfile();
    expect(mockNavigate).toHaveBeenCalledWith("/auth");
  });

  it("renders profile form after loading", async () => {
    renderProfile();
    await waitFor(() => {
      expect(screen.getByText("Profil")).toBeInTheDocument();
    });
    expect(screen.getByDisplayValue("Alice")).toBeInTheDocument();
    expect(screen.getByText("test@example.com")).toBeInTheDocument();
  });

  it("shows initials when no avatar", async () => {
    renderProfile();
    await waitFor(() => {
      expect(screen.getByText("A")).toBeInTheDocument();
    });
  });

  it("updates display name on save", async () => {
    renderProfile();
    await waitFor(() => screen.getByDisplayValue("Alice"));

    const input = screen.getByDisplayValue("Alice");
    fireEvent.change(input, { target: { value: "Bob" } });
    fireEvent.click(screen.getByText("Enregistrer"));

    await waitFor(() => {
      expect(mockUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ display_name: "Bob" })
      );
      expect(mockToastSuccess).toHaveBeenCalledWith("Profil mis à jour");
    });
  });

  it("rejects files over 2 MB", async () => {
    renderProfile();
    await waitFor(() => screen.getByText("Profil"));

    const file = new File(["x".repeat(3 * 1024 * 1024)], "big.png", {
      type: "image/png",
    });
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => {
      expect(mockToastError).toHaveBeenCalledWith(
        "L'image doit faire moins de 2 Mo"
      );
    });
    expect(mockUpload).not.toHaveBeenCalled();
  });

  it("uploads avatar and updates profile", async () => {
    renderProfile();
    await waitFor(() => screen.getByText("Profil"));

    const file = new File(["img"], "photo.jpg", { type: "image/jpeg" });
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => {
      expect(mockUpload).toHaveBeenCalledWith(
        "user-123/avatar.jpg",
        file,
        { upsert: true }
      );
      expect(mockToastSuccess).toHaveBeenCalledWith("Avatar mis à jour");
    });
  });

  it("shows upload error via toast", async () => {
    mockUpload.mockResolvedValue({ error: { message: "Upload failed" } });
    renderProfile();
    await waitFor(() => screen.getByText("Profil"));

    const file = new File(["img"], "photo.png", { type: "image/png" });
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => {
      expect(mockToastError).toHaveBeenCalledWith("Upload failed");
    });
  });

  it("shows avatar image when avatarUrl is set", async () => {
    mockSelect.mockResolvedValue({
      data: { display_name: "Eve", avatar_url: "https://cdn.example.com/eve.png" },
      error: null,
    });
    renderProfile();
    await waitFor(() => {
      const img = screen.getByAltText("Avatar");
      expect(img).toBeInTheDocument();
      expect(img).toHaveAttribute("src", "https://cdn.example.com/eve.png");
    });
  });
});
