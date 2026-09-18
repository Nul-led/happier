import { Platform } from 'react-native';

/** Exact ancestor origin shared by installed and caller-authored framed surfaces. */
export function resolveHostedFrameHostOrigin(): string | null {
    if (Platform.OS !== 'web') return 'https://happier.native';
    const location = Reflect.get(globalThis, 'location');
    if (!location || typeof location !== 'object') return null;
    const origin = Reflect.get(location, 'origin');
    return typeof origin === 'string' && origin.length > 0 && origin !== 'null' ? origin : null;
}
