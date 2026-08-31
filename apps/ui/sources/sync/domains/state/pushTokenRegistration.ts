import { readStorageScopeFromEnv, scopedStorageId } from '@/utils/system/storageScope';

const isWebRuntime = typeof window !== 'undefined' && typeof document !== 'undefined';

type MmkvStorage = import('react-native-mmkv').MMKV;

let storage: MmkvStorage | null = null;

function getStorage(): MmkvStorage {
    if (storage) return storage;
    if (isWebRuntime) {
        throw new Error('MMKV storage is not available on web runtime');
    }
    const mmkvModule = require('react-native-mmkv') as typeof import('react-native-mmkv');
    const scope = readStorageScopeFromEnv();
    storage = new mmkvModule.MMKV({ id: scopedStorageId('push-token-registration', scope) });
    return storage;
}

const KEY_LAST_EXPO_PUSH_TOKEN = 'lastExpoPushTokenV1';
const KEY_EXPO_PUSH_TOKEN_GENERATION = 'expoPushTokenGenerationV1';
const LOCAL_STORAGE_KEY_LAST_EXPO_PUSH_TOKEN = `${scopedStorageId('push-token-registration', null)}:${KEY_LAST_EXPO_PUSH_TOKEN}`;
const LOCAL_STORAGE_KEY_EXPO_PUSH_TOKEN_GENERATION = `${scopedStorageId('push-token-registration', null)}:${KEY_EXPO_PUSH_TOKEN_GENERATION}`;

/**
 * Bounded device-level push token generation state: the Expo token this device
 * currently observes plus at most one prior token that may still be registered
 * on some Home and is pending cleanup. This is not a per-Home ledger; Home
 * attribution lives on the server (`accountPushToken.clientServerUrl`).
 */
export type RegisteredExpoPushTokenState = Readonly<{
    /** Token observed on this device and processed by the latest registration cycle. */
    current: string | null;
    /** Prior token retained until every Home completed old-token cleanup. */
    cleanupPending: string | null;
}>;

type StoredExpoPushTokenGenerationV1 = {
    v: 1;
    current: string;
    cleanupPending?: string;
};

function safeLocalStorageGetString(key: string): string | null {
    try {
        return typeof window?.localStorage?.getItem === 'function' ? window.localStorage.getItem(key) : null;
    } catch {
        return null;
    }
}

function safeLocalStorageSetString(key: string, value: string): void {
    try {
        if (typeof window?.localStorage?.setItem === 'function') {
            window.localStorage.setItem(key, value);
        }
    } catch {
        // ignore
    }
}

function safeLocalStorageDelete(key: string): void {
    try {
        if (typeof window?.localStorage?.removeItem === 'function') {
            window.localStorage.removeItem(key);
        }
    } catch {
        // ignore
    }
}

function getLegacyRawValue(): string | null {
    if (isWebRuntime) {
        return safeLocalStorageGetString(LOCAL_STORAGE_KEY_LAST_EXPO_PUSH_TOKEN);
    }
    return getStorage().getString(KEY_LAST_EXPO_PUSH_TOKEN) ?? null;
}

function getGenerationRawValue(): string | null {
    if (isWebRuntime) {
        return safeLocalStorageGetString(LOCAL_STORAGE_KEY_EXPO_PUSH_TOKEN_GENERATION);
    }
    return getStorage().getString(KEY_EXPO_PUSH_TOKEN_GENERATION) ?? null;
}

function setGenerationRawValue(value: string): void {
    if (isWebRuntime) {
        safeLocalStorageSetString(LOCAL_STORAGE_KEY_EXPO_PUSH_TOKEN_GENERATION, value);
        return;
    }
    getStorage().set(KEY_EXPO_PUSH_TOKEN_GENERATION, value);
}

function deleteLegacyRawValue(): void {
    if (isWebRuntime) {
        safeLocalStorageDelete(LOCAL_STORAGE_KEY_LAST_EXPO_PUSH_TOKEN);
        return;
    }
    getStorage().delete(KEY_LAST_EXPO_PUSH_TOKEN);
}

function normalizeToken(value: unknown): string | null {
    const token = typeof value === 'string' ? value.trim() : '';
    return token || null;
}

function parseGenerationState(raw: string | null, legacyRaw: string | null): RegisteredExpoPushTokenState {
    if (raw) {
        try {
            const parsed = JSON.parse(raw) as Partial<StoredExpoPushTokenGenerationV1> | null;
            if (parsed && parsed.v === 1) {
                const current = normalizeToken(parsed.current);
                const cleanupPending = normalizeToken(parsed.cleanupPending);
                return { current, cleanupPending: cleanupPending && cleanupPending !== current ? cleanupPending : null };
            }
        } catch {
            // Unreadable generation record: fall through to the legacy scalar.
        }
    }
    return { current: normalizeToken(legacyRaw), cleanupPending: null };
}

export function loadRegisteredExpoPushTokenState(): RegisteredExpoPushTokenState {
    return parseGenerationState(getGenerationRawValue(), getLegacyRawValue());
}

export function loadLastRegisteredExpoPushToken(): string | null {
    return loadRegisteredExpoPushTokenState().current;
}

/**
 * Persist the device token generation. `cleanupPending` retains a prior token
 * until every Home completed old-token cleanup; a full-success commit omits it.
 */
export function saveExpoPushTokenGeneration(params: Readonly<{
    current: string;
    cleanupPending?: string | null;
}>): void {
    const current = normalizeToken(params.current);
    if (!current) return;
    const cleanupPending = normalizeToken(params.cleanupPending);
    const record: StoredExpoPushTokenGenerationV1 = cleanupPending && cleanupPending !== current
        ? { v: 1, current, cleanupPending }
        : { v: 1, current };
    setGenerationRawValue(JSON.stringify(record));
    // The legacy scalar must not resurrect a stale token once generation state exists.
    deleteLegacyRawValue();
}

/** Full-success commit: the observed token is registered everywhere and no cleanup is pending. */
export function saveLastRegisteredExpoPushToken(token: string): void {
    saveExpoPushTokenGeneration({ current: token });
}

/**
 * Canonical owner helper for cleanup callers: every token that must be
 * unregistered on Home logout, global credential forget, or profile removal.
 */
export function loadExpoPushTokensToUnregister(): string[] {
    const state = loadRegisteredExpoPushTokenState();
    const tokens = state.current ? [state.current] : [];
    if (state.cleanupPending && state.cleanupPending !== state.current) {
        tokens.push(state.cleanupPending);
    }
    return tokens;
}

export function clearLastRegisteredExpoPushToken(): void {
    if (isWebRuntime) {
        safeLocalStorageDelete(LOCAL_STORAGE_KEY_LAST_EXPO_PUSH_TOKEN);
        safeLocalStorageDelete(LOCAL_STORAGE_KEY_EXPO_PUSH_TOKEN_GENERATION);
        return;
    }
    getStorage().delete(KEY_LAST_EXPO_PUSH_TOKEN);
    getStorage().delete(KEY_EXPO_PUSH_TOKEN_GENERATION);
}
