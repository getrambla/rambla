import { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Text, View } from "react-native";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { DesktopPermissionRow } from "@/desktop/components/desktop-permission-row";
import { useDesktopPermissions } from "@/desktop/permissions/use-desktop-permissions";
import { useDesktopSettings } from "@/desktop/settings/desktop-settings";
import { SettingsSection } from "@/components/settings/headings/settings-section";
import { settingsStyles } from "@/styles/settings";

// RAMBLA-FORK: feature: 2026-09-22-feat-os-notification-toggle.md: reads and writes the OS notifications preference; removes the refresh button and its icon, imports, and handler.
import { useSettings } from "@/hooks/use-settings";

export function DesktopNotificationsSection() {
  const { t } = useTranslation();
  const { settings, isSaving, updateSettings } = useDesktopSettings();
  // RAMBLA-FORK: feature: 2026-09-22-feat-os-notification-toggle.md: drops refreshPermissions with the refresh handler.
  const {
    isDesktopApp,
    snapshot,
    requestingPermission,
    testNotificationState,
    requestPermission,
    sendTestNotification,
  } = useDesktopPermissions();

  // RAMBLA-FORK: feature: 2026-09-22-feat-os-notification-toggle.md: removes the refresh handler with the refresh button.
  const handleRequestNotifications = useCallback(() => {
    void requestPermission("notifications");
  }, [requestPermission]);

  const handlePlaySoundChange = useCallback(
    (playSound: boolean) => {
      void updateSettings({ notifications: { playSound } }).catch(() => {
        // useDesktopSettings owns the user-visible IPC error.
      });
    },
    [updateSettings],
  );

  const handleSendTestNotification = useCallback(() => {
    void sendTestNotification();
  }, [sendTestNotification]);

  // RAMBLA-FORK: feature: 2026-09-22-feat-os-notification-toggle.md: isPermissionBusy drops isRefreshing with the refresh button.
  const isPermissionBusy = requestingPermission !== null;
  const isSendingTestNotification = testNotificationState.status === "sending";
  // RAMBLA-FORK: feature: 2026-09-22-feat-os-notification-toggle.md: remove refreshButton and refreshIcon.
  const permissionLabels = useMemo(
    () => ({
      granted: t("settings.permissions.actions.granted"),
      request: t("settings.permissions.actions.request"),
      requesting: t("settings.permissions.actions.requesting"),
    }),
    [t],
  );

  const { settings: appSettings, updateSettings: updateAppSettings } = useSettings();
  const handleOsNotificationsChange = useCallback(
    (notificationsEnabled: boolean) => {
      void updateAppSettings({ notificationsEnabled }).catch(() => {
        // useAppSettings owns the user-visible persistence error.
      });
    },
    [updateAppSettings],
  );
  const notificationsSwitch = useMemo(
    () => (
      <Switch
        value={appSettings.notificationsEnabled}
        onValueChange={handleOsNotificationsChange}
        accessibilityLabel={t("settings.notifications.title")}
        testID="desktop-os-notifications-switch"
      />
    ),
    [appSettings.notificationsEnabled, handleOsNotificationsChange, t],
  );

  if (!isDesktopApp) {
    return null;
  }

  // RAMBLA-FORK: feature: 2026-09-22-feat-os-notification-toggle.md: preference off keeps the heading and switch, hides the card.
  if (!appSettings.notificationsEnabled) {
    return (
      <SettingsSection title={t("settings.notifications.title")} trailing={notificationsSwitch}>
        {null}
      </SettingsSection>
    );
  }

  const notificationsGranted = snapshot?.notifications.state === "granted";

  return (
    // RAMBLA-FORK: feature: 2026-09-22-feat-os-notification-toggle.md: add Notifications switch.
    <SettingsSection title={t("settings.notifications.title")} trailing={notificationsSwitch}>
      <View style={settingsStyles.card}>
        <DesktopPermissionRow
          title={t("settings.notifications.permission")}
          status={snapshot?.notifications ?? null}
          isRequesting={requestingPermission === "notifications"}
          onRequest={handleRequestNotifications}
          labels={permissionLabels}
        />
        <View style={[settingsStyles.row, settingsStyles.rowBorder]}>
          <View style={settingsStyles.rowContent}>
            <Text style={settingsStyles.rowTitle}>{t("settings.notifications.playSound")}</Text>
            <Text style={settingsStyles.rowHint}>{t("settings.notifications.playSoundHint")}</Text>
          </View>
          <Switch
            value={settings.notifications.playSound}
            onValueChange={handlePlaySoundChange}
            disabled={isSaving}
            accessibilityLabel={t("settings.notifications.playSound")}
            testID="desktop-notifications-play-sound-switch"
          />
        </View>
        <View style={[settingsStyles.row, settingsStyles.rowBorder]}>
          <View style={settingsStyles.rowContent}>
            <Text style={settingsStyles.rowTitle}>{t("settings.notifications.test")}</Text>
            <Text style={settingsStyles.rowHint}>
              {notificationsGranted
                ? t("settings.notifications.testHint")
                : t("settings.notifications.permissionRequired")}
            </Text>
          </View>
          <Button
            variant="outline"
            size="sm"
            onPress={handleSendTestNotification}
            disabled={!notificationsGranted || isPermissionBusy || isSendingTestNotification}
          >
            {isSendingTestNotification
              ? t("settings.notifications.sending")
              : t("settings.notifications.send")}
          </Button>
        </View>
      </View>
      {testNotificationState.status === "success" ? (
        <Alert
          variant="success"
          title={t("settings.notifications.sentTitle")}
          description={t("settings.notifications.sentDescription")}
          testID="desktop-notifications-test-success"
        />
      ) : null}
      {testNotificationState.status === "error" ? (
        <Alert
          variant="error"
          title={t("settings.notifications.sendFailedTitle")}
          description={testNotificationState.message}
          testID="desktop-notifications-test-error"
        />
      ) : null}
    </SettingsSection>
  );
}
