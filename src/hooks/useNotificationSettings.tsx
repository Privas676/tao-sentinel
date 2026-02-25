import { createContext, useContext, useState, useCallback, ReactNode } from "react";

export interface NotificationSettings {
  soundEnabled: boolean;
  pushEnabled: boolean;
}

const STORAGE_KEY = "tao-sentinel-notif-settings";

function loadSettings(): NotificationSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return { soundEnabled: true, pushEnabled: true };
}

function saveSettings(s: NotificationSettings) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
}

interface Ctx extends NotificationSettings {
  setSoundEnabled: (v: boolean) => void;
  setPushEnabled: (v: boolean) => void;
}

const NotificationSettingsContext = createContext<Ctx | null>(null);

export function NotificationSettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<NotificationSettings>(loadSettings);

  const setSoundEnabled = useCallback((v: boolean) => {
    setSettings((prev) => {
      const next = { ...prev, soundEnabled: v };
      saveSettings(next);
      return next;
    });
  }, []);

  const setPushEnabled = useCallback((v: boolean) => {
    setSettings((prev) => {
      const next = { ...prev, pushEnabled: v };
      saveSettings(next);
      return next;
    });
  }, []);

  return (
    <NotificationSettingsContext.Provider
      value={{ ...settings, setSoundEnabled, setPushEnabled }}
    >
      {children}
    </NotificationSettingsContext.Provider>
  );
}

export function useNotificationSettings() {
  const ctx = useContext(NotificationSettingsContext);
  if (!ctx) throw new Error("useNotificationSettings must be used within provider");
  return ctx;
}
