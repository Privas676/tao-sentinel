import { useState, useRef, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { toast } from "sonner";
import { useNavigate } from "react-router-dom";

export default function ProfilePage() {
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [displayName, setDisplayName] = useState("");
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [profileLoaded, setProfileLoaded] = useState(false);

  // Redirect if not authenticated
  useEffect(() => {
    if (!authLoading && !user) navigate("/auth");
  }, [authLoading, user, navigate]);

  // Fetch profile
  useEffect(() => {
    if (!user) return;
    (async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("display_name, avatar_url")
        .eq("id", user.id)
        .maybeSingle();
      if (!error && data) {
        setDisplayName(data.display_name ?? "");
        setAvatarUrl(data.avatar_url);
      }
      setProfileLoaded(true);
    })();
  }, [user]);

  const handleSave = async () => {
    if (!user) return;
    setLoading(true);
    try {
      const { error } = await supabase
        .from("profiles")
        .update({
          display_name: displayName,
          updated_at: new Date().toISOString(),
        })
        .eq("id", user.id);
      if (error) throw error;
      toast.success("Profil mis à jour");
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !user) return;

    if (file.size > 2 * 1024 * 1024) {
      toast.error("L'image doit faire moins de 2 Mo");
      return;
    }

    setUploading(true);
    try {
      const ext = file.name.split(".").pop()?.toLowerCase() ?? "png";
      const filePath = `${user.id}/avatar.${ext}`;

      const { error: uploadError } = await supabase.storage
        .from("avatars")
        .upload(filePath, file, { upsert: true });
      if (uploadError) throw uploadError;

      const { data: urlData } = supabase.storage
        .from("avatars")
        .getPublicUrl(filePath);

      const publicUrl = `${urlData.publicUrl}?t=${Date.now()}`;

      const { error: updateError } = await supabase
        .from("profiles")
        .update({
          avatar_url: publicUrl,
          updated_at: new Date().toISOString(),
        })
        .eq("id", user.id);
      if (updateError) throw updateError;

      setAvatarUrl(publicUrl);
      toast.success("Avatar mis à jour");
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setUploading(false);
    }
  };

  if (authLoading || !profileLoaded) {
    return (
      <div className="h-full flex items-center justify-center">
        <span className="font-mono text-xs text-white/30 animate-pulse">Chargement…</span>
      </div>
    );
  }

  const initials = (displayName || user?.email || "?")
    .split(/[\s@]+/)
    .map((w) => w[0]?.toUpperCase())
    .slice(0, 2)
    .join("");

  return (
    <div className="h-full overflow-y-auto px-4 pt-16 pb-8">
      <div className="max-w-md mx-auto font-mono space-y-8">
        <h1
          className="text-lg font-bold tracking-widest uppercase"
          style={{ color: "rgba(255,255,255,0.7)" }}
        >
          Profil
        </h1>

        {/* Avatar */}
        <div className="flex flex-col items-center gap-3">
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            className="relative w-24 h-24 rounded-full overflow-hidden transition-all hover:ring-2 hover:ring-white/20 disabled:opacity-50 group"
            style={{
              background: "rgba(255,255,255,0.06)",
              border: "2px solid rgba(255,255,255,0.1)",
            }}
          >
            {avatarUrl ? (
              <img
                src={avatarUrl}
                alt="Avatar"
                className="w-full h-full object-cover"
              />
            ) : (
              <span
                className="flex items-center justify-center w-full h-full text-2xl font-bold"
                style={{ color: "rgba(255,255,255,0.4)" }}
              >
                {initials}
              </span>
            )}
            <div
              className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
              style={{ background: "rgba(0,0,0,0.6)" }}
            >
              <span className="text-xs text-white/70">
                {uploading ? "⏳" : "📷"}
              </span>
            </div>
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            onChange={handleAvatarUpload}
            className="hidden"
          />
          <span
            className="text-[10px] tracking-wider"
            style={{ color: "rgba(255,255,255,0.25)" }}
          >
            Cliquez pour changer l'avatar (max 2 Mo)
          </span>
        </div>

        {/* Display name */}
        <div>
          <label
            className="block text-[10px] tracking-widest uppercase mb-1.5"
            style={{ color: "rgba(255,255,255,0.3)" }}
          >
            Nom d'affichage
          </label>
          <input
            type="text"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            className="w-full px-3 py-2.5 rounded-lg text-sm bg-white/[0.04] border border-white/[0.08] text-white/80 focus:border-white/20 focus:outline-none transition-colors"
            placeholder="Votre nom"
          />
        </div>

        {/* Email (read-only) */}
        <div>
          <label
            className="block text-[10px] tracking-widest uppercase mb-1.5"
            style={{ color: "rgba(255,255,255,0.3)" }}
          >
            Email
          </label>
          <div
            className="w-full px-3 py-2.5 rounded-lg text-sm truncate"
            style={{
              background: "rgba(255,255,255,0.02)",
              border: "1px solid rgba(255,255,255,0.05)",
              color: "rgba(255,255,255,0.4)",
            }}
          >
            {user?.email}
          </div>
        </div>

        {/* Save */}
        <button
          onClick={handleSave}
          disabled={loading}
          className="w-full py-2.5 rounded-lg text-sm font-semibold tracking-wider uppercase transition-all disabled:opacity-50"
          style={{
            background: "rgba(255,255,255,0.06)",
            color: "rgba(255,255,255,0.7)",
            border: "1px solid rgba(255,255,255,0.1)",
          }}
        >
          {loading ? "..." : "Enregistrer"}
        </button>
      </div>
    </div>
  );
}
