import {
    serializeServerConfigValue,
    validateServerConfigText,
    validateServerConfigValue,
    type ServerConfigInvalidReason,
} from './serverConfigCodec.js';
import type { ServerConfigEntry, ServerConfigRegistry, ServerConfigValue } from './serverConfigEntry.js';

/**
 * Validation of a `home.settings.set` write against the server configuration registry (§3.14).
 *
 * Only registry-declared, `editable: 'home'` keys can be written; secrets travel in their own map
 * and never in `values`. A `null` value clears the persisted setting. The first failing key is
 * reported with a typed reason; nothing is written unless every key passes.
 */
export const HOME_SETTINGS_INVALID_ERROR = 'home_settings_invalid' as const;

export type HomeSettingsInvalidReason =
    | ServerConfigInvalidReason
    | 'unknown_key'
    | 'not_home_editable'
    | 'secret_in_values'
    | 'not_secret';

export type HomeSettingsSecretWrite = Readonly<{ replace: string }> | Readonly<{ clear: true }>;

export type HomeSettingsWriteInput = Readonly<{
    values: Readonly<Record<string, unknown>>;
    secrets?: Readonly<Record<string, HomeSettingsSecretWrite>>;
}>;

export type HomeSettingsWriteValidation =
    | Readonly<{
        ok: true;
        /** Normalized values; `null` clears the key. */
        values: Readonly<Record<string, ServerConfigValue | null>>;
        /** `string` replaces the sealed secret; `null` clears it. */
        secrets: Readonly<Record<string, string | null>>;
    }>
    | Readonly<{
        ok: false;
        error: typeof HOME_SETTINGS_INVALID_ERROR;
        key: string;
        reason: HomeSettingsInvalidReason;
    }>;

export function validateHomeSettingsWrite(
    registry: ServerConfigRegistry,
    input: HomeSettingsWriteInput,
): HomeSettingsWriteValidation {
    const refuse = (key: string, reason: HomeSettingsInvalidReason): HomeSettingsWriteValidation => ({
        ok: false,
        error: HOME_SETTINGS_INVALID_ERROR,
        key,
        reason,
    });
    const writableEntry = (
        key: string,
    ): { readonly ok: true; readonly entry: ServerConfigEntry } | { readonly ok: false; readonly reason: HomeSettingsInvalidReason } => {
        // Registry declarations are own properties; retain that boundary check while making
        // the successful result explicit for the strict compiler.
        const entry = Object.hasOwn(registry, key) ? registry[key] : undefined;
        if (entry === undefined) return { ok: false, reason: 'unknown_key' };
        if (entry.editable !== 'home') return { ok: false, reason: 'not_home_editable' };
        return { ok: true, entry };
    };

    const values: Record<string, ServerConfigValue | null> = {};
    for (const [key, value] of Object.entries(input.values)) {
        const found = writableEntry(key);
        if (!found.ok) return refuse(key, found.reason);
        if (found.entry.sensitivity === 'secret') return refuse(key, 'secret_in_values');
        if (value === null) {
            values[key] = null;
            continue;
        }
        const validated = validateServerConfigValue(found.entry, value);
        if (!validated.ok) return refuse(key, validated.reason);
        values[key] = validated.value;
    }

    const secrets: Record<string, string | null> = {};
    for (const [key, write] of Object.entries(input.secrets ?? {})) {
        const found = writableEntry(key);
        if (!found.ok) return refuse(key, found.reason);
        if (found.entry.sensitivity !== 'secret') return refuse(key, 'not_secret');
        if ('clear' in write) {
            secrets[key] = null;
            continue;
        }
        const validated = validateServerConfigText(found.entry, write.replace);
        if (!validated.ok) return refuse(key, validated.reason);
        secrets[key] = serializeServerConfigValue(found.entry, validated.value);
    }

    return { ok: true, values: Object.freeze(values), secrets: Object.freeze(secrets) };
}
