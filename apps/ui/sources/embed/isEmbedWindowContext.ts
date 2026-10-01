import { Platform } from 'react-native';

// The realm's boot context is immutable: navigating within the frame must never adopt the app's
// persisted credentials or start its Account runtimes.
const embedWindowContext = Platform.OS === 'web'
    && typeof window !== 'undefined'
    && window.location?.pathname?.startsWith('/embed/') === true;

export function isEmbedWindowContext(): boolean {
    return embedWindowContext;
}
