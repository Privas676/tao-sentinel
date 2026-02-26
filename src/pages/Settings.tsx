import { Volume2, VolumeX, Bell, BellOff, Shield } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useNotificationSettings } from "@/hooks/useNotificationSettings";
import { useLanguage } from "@/i18n/LanguageContext";
import { requestNotificationPermission } from "@/lib/notifications";
import { useState, useEffect } from "react";

export default function Settings() {
  const { soundEnabled, pushEnabled, setSoundEnabled, setPushEnabled } = useNotificationSettings();
  const { t } = useLanguage();
  const [permissionState, setPermissionState] = useState<NotificationPermission>(
    typeof window !== "undefined" && "Notification" in window ? Notification.permission : "denied"
  );

  useEffect(() => {
    if ("Notification" in window) setPermissionState(Notification.permission);
  }, []);

  const handleRequestPermission = async () => {
    const granted = await requestNotificationPermission();
    setPermissionState(granted ? "granted" : "denied");
  };

  return (
    <div className="p-4 md:p-6 max-w-2xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">{t("settings.title")}</h1>
        <p className="text-sm text-muted-foreground mt-1">{t("settings.subtitle")}</p>
      </div>

      <Card className="border-border bg-card">
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Volume2 className="h-5 w-5 text-primary" />
            {t("settings.sound")}
          </CardTitle>
          <CardDescription>{t("settings.soundDesc")}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between">
            <Label htmlFor="sound-toggle" className="flex items-center gap-2 text-sm cursor-pointer">
              {soundEnabled ? <Volume2 className="h-4 w-4 text-signal-go" /> : <VolumeX className="h-4 w-4 text-muted-foreground" />}
              {soundEnabled ? t("settings.soundOn") : t("settings.soundOff")}
            </Label>
            <Switch id="sound-toggle" checked={soundEnabled} onCheckedChange={setSoundEnabled} />
          </div>
        </CardContent>
      </Card>

      <Card className="border-border bg-card">
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Bell className="h-5 w-5 text-primary" />
            {t("settings.push")}
          </CardTitle>
          <CardDescription>{t("settings.pushDesc")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <Label htmlFor="push-toggle" className="flex items-center gap-2 text-sm cursor-pointer">
              {pushEnabled ? <Bell className="h-4 w-4 text-signal-go" /> : <BellOff className="h-4 w-4 text-muted-foreground" />}
              {pushEnabled ? t("settings.pushOn") : t("settings.pushOff")}
            </Label>
            <Switch id="push-toggle" checked={pushEnabled} onCheckedChange={setPushEnabled} />
          </div>

          {pushEnabled && permissionState !== "granted" && (
            <div className="flex items-center gap-3 p-3 rounded-md bg-muted/50 border border-border">
              <Shield className="h-4 w-4 text-muted-foreground flex-shrink-0" />
              <div className="flex-1">
                <p className="text-xs text-muted-foreground">
                  {permissionState === "denied" ? t("settings.permBlocked") : t("settings.permRequired")}
                </p>
              </div>
              {permissionState !== "denied" && (
                <Button size="sm" variant="outline" className="text-xs" onClick={handleRequestPermission}>
                  {t("settings.grantPerm")}
                </Button>
              )}
            </div>
          )}

          {pushEnabled && permissionState === "granted" && (
            <p className="text-xs text-signal-go flex items-center gap-1.5">
              <Shield className="h-3.5 w-3.5" />
              {t("settings.permGranted")}
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
