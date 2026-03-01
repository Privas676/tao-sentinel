import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable/index";
import { toast } from "sonner";

export default function AuthPage() {
  const [mode, setMode] = useState<"login" | "signup" | "forgot">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      if (mode === "forgot") {
        const { error } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: `${window.location.origin}/reset-password`,
        });
        if (error) throw error;
        toast.success("Email de réinitialisation envoyé — vérifiez votre boîte mail");
        setMode("login");
      } else if (mode === "login") {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      } else {
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: window.location.origin },
        });
        if (error) throw error;
        toast.success("Vérifiez votre email pour confirmer votre compte");
      }
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleGoogle = async () => {
    setGoogleLoading(true);
    try {
      const { error } = await lovable.auth.signInWithOAuth("google", {
        redirect_uri: window.location.origin,
      });
      if (error) toast.error(String(error));
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setGoogleLoading(false);
    }
  };

  const title = mode === "forgot" ? "Réinitialiser" : mode === "login" ? "Connexion" : "Créer un compte";

  return (
    <div className="fixed inset-0 bg-black flex items-center justify-center">
      <div className="w-full max-w-sm mx-4 font-mono">
        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold tracking-widest" style={{ color: "rgba(255,255,255,0.8)" }}>
            TAO SENTINEL
          </h1>
          <p className="text-xs tracking-wider mt-2" style={{ color: "rgba(255,255,255,0.3)" }}>
            {title}
          </p>
        </div>

        {/* Google OAuth */}
        {mode !== "forgot" && (
          <button
            onClick={handleGoogle}
            disabled={googleLoading}
            className="w-full py-2.5 rounded-lg text-sm font-semibold tracking-wider flex items-center justify-center gap-2 mb-4 transition-all disabled:opacity-50 hover:brightness-110"
            style={{
              background: "rgba(255,255,255,0.08)",
              color: "rgba(255,255,255,0.7)",
              border: "1px solid rgba(255,255,255,0.12)",
            }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
              <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/>
              <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
              <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18A10.96 10.96 0 001 12c0 1.77.42 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05"/>
              <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
            </svg>
            {googleLoading ? "..." : "Continuer avec Google"}
          </button>
        )}

        {mode !== "forgot" && (
          <div className="flex items-center gap-3 mb-4">
            <div className="flex-1 h-px" style={{ background: "rgba(255,255,255,0.08)" }} />
            <span className="text-[10px] tracking-wider" style={{ color: "rgba(255,255,255,0.2)" }}>ou</span>
            <div className="flex-1 h-px" style={{ background: "rgba(255,255,255,0.08)" }} />
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-[10px] tracking-widest uppercase mb-1.5" style={{ color: "rgba(255,255,255,0.3)" }}>
              Email
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="w-full px-3 py-2.5 rounded-lg text-sm bg-white/[0.04] border border-white/[0.08] text-white/80 focus:border-white/20 focus:outline-none transition-colors"
              placeholder="email@example.com"
            />
          </div>

          {mode !== "forgot" && (
            <div>
              <label className="block text-[10px] tracking-widest uppercase mb-1.5" style={{ color: "rgba(255,255,255,0.3)" }}>
                Mot de passe
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={6}
                className="w-full px-3 py-2.5 rounded-lg text-sm bg-white/[0.04] border border-white/[0.08] text-white/80 focus:border-white/20 focus:outline-none transition-colors"
                placeholder="••••••••"
              />
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full py-2.5 rounded-lg text-sm font-semibold tracking-wider uppercase transition-all disabled:opacity-50"
            style={{
              background: "rgba(255,255,255,0.06)",
              color: "rgba(255,255,255,0.7)",
              border: "1px solid rgba(255,255,255,0.1)",
            }}
          >
            {loading
              ? "..."
              : mode === "forgot"
              ? "Envoyer le lien"
              : mode === "login"
              ? "Se connecter"
              : "Créer le compte"}
          </button>
        </form>

        <div className="mt-4 space-y-2 text-center">
          {mode === "login" && (
            <button
              onClick={() => setMode("forgot")}
              className="block w-full text-[10px] tracking-wider py-1 transition-colors"
              style={{ color: "rgba(255,255,255,0.25)" }}
            >
              Mot de passe oublié ?
            </button>
          )}
          <button
            onClick={() => setMode(mode === "signup" ? "login" : mode === "forgot" ? "login" : "signup")}
            className="block w-full text-xs tracking-wider py-2 transition-colors"
            style={{ color: "rgba(255,255,255,0.3)" }}
          >
            {mode === "signup"
              ? "Déjà un compte ? Se connecter"
              : mode === "forgot"
              ? "Retour à la connexion"
              : "Pas de compte ? S'inscrire"}
          </button>
        </div>
      </div>
    </div>
  );
}
