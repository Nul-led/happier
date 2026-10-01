/** Electron's login-item API is an OS boundary, supported only on macOS and Windows. */
type LoginItemApi = Readonly<{
    getLoginItemSettings: () => Readonly<{ openAtLogin: boolean }>;
    setLoginItemSettings: (settings: Readonly<{ openAtLogin: boolean }>) => void;
}>;

/** The service preference is the authority; this adapter stores no separate app preference. */
export function createLoginItemWriter(params: Readonly<{
    api: LoginItemApi;
    platform: NodeJS.Platform;
    isPackaged: boolean;
    development: boolean;
}>): Readonly<{ setEnabled: (enabled: boolean) => void }> {
    let appliedEnabled: boolean | null = null;
    let unsupportedPlatformNoticeShown = false;
    return {
        setEnabled(enabled) {
            if (!params.isPackaged || params.development) return;
            if (params.platform !== 'darwin' && params.platform !== 'win32') {
                if (!unsupportedPlatformNoticeShown) {
                    unsupportedPlatformNoticeShown = true;
                    console.warn(`desktop_login_item_unsupported_platform: ${params.platform}; automatic login startup was not changed.`);
                }
                return;
            }
            if (appliedEnabled === enabled) return;
            // Keep the existing normal-window startup. Electron has no menu-bar lifecycle yet;
            // passing --menu-bar would currently be an ignored argument, not background startup.
            params.api.setLoginItemSettings({ openAtLogin: enabled });
            if (params.api.getLoginItemSettings().openAtLogin !== enabled) {
                throw new Error('desktop_login_item_update_failed: The OS login item did not match the background-service setting.');
            }
            appliedEnabled = enabled;
        },
    };
}
