export function normalizeSecretPromptInput(value: string | null): string | null {
    if (value === null) return null;
    return value.length > 0 ? value : null;
}
