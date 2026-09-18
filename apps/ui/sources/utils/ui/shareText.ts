import { Platform, Share } from 'react-native';

/**
 * Handing one short piece of text — a link — to another app.
 *
 * Copy is always available; a share sheet is not. Web without the Web Share API,
 * desktop shells and the test runtime all legitimately lack one, and a control
 * that silently does nothing there is worse than no control, so this reports
 * `unavailable` and lets the caller keep offering Copy alone.
 *
 * Nothing is written to disk: the existing file-based `expo-sharing` paths would
 * persist a bearer link outside the process, which is exactly what an invitation
 * link must never do.
 */
export type ShareTextOutcome = 'shared' | 'dismissed' | 'unavailable';

type WebShareNavigator = Readonly<{ share?: (data: { text?: string; url?: string }) => Promise<void> }>;

function webShare(): WebShareNavigator['share'] | null {
    const candidate = (globalThis as { navigator?: WebShareNavigator }).navigator;
    return typeof candidate?.share === 'function' ? candidate.share.bind(candidate) : null;
}

/**
 * The platform sheet, and only where one really exists.
 *
 * React Native for Web exports `Share.share` even where the browser has no Web
 * Share API, and it simply rejects there. Trusting that export on web would put
 * a Share control on every desktop browser and have it do nothing — so on web
 * the Web Share API above is the only accepted sheet.
 */
function nativeShare(): typeof Share.share | null {
    if (Platform.OS === 'web') return null;
    return typeof Share?.share === 'function' ? Share.share : null;
}

export function isTextSharingAvailable(): boolean {
    return webShare() !== null || nativeShare() !== null;
}

export async function shareTextSafe(value: string): Promise<ShareTextOutcome> {
    const fromWeb = webShare();
    if (fromWeb) {
        try {
            await fromWeb({ text: value });
            return 'shared';
        } catch {
            // A user-cancelled Web Share rejects exactly like a refused one, so
            // the caller is told nothing left the app rather than being shown a
            // failure it cannot act on.
            return 'dismissed';
        }
    }

    const fromNative = nativeShare();
    if (!fromNative) return 'unavailable';
    try {
        const result = await fromNative({ message: value });
        // The constant is read from the module when it is present so a platform
        // that renames it stays correct, with the published value as the floor.
        const dismissed = Share?.dismissedAction ?? 'dismissedAction';
        return result?.action === dismissed ? 'dismissed' : 'shared';
    } catch {
        return 'dismissed';
    }
}
