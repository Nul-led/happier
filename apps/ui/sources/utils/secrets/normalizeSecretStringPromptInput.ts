import type { SecretString } from '@/sync/encryption/secretSettings';

/**
 * Normalize raw prompt text into a sealed {@link SecretString} (or `null`).
 *
 * Treats empty input as "cleared" (`null`). Non-empty input is preserved
 * exactly and wrapped in the canonical
 * `{ _isSecretValue: true, value }` envelope so secret settings stay sealed.
 *
 * Single owner for the previously-duplicated per-panel copies of this helper.
 */
export function normalizeSecretStringPromptInput(value: string | null): SecretString | null {
    if (value === null) return null;
    return value.length > 0 ? { _isSecretValue: true, value } : null;
}
