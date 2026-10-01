export type AppVariant = 'development' | 'preview' | 'production';

function toNonEmptyString(value: unknown): string | null {
    if (typeof value !== 'string') {
        return null;
    }
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
}

function normalizeAppVariant(value: unknown): AppVariant | null {
    const normalized = toNonEmptyString(value)?.toLowerCase() ?? null;
    if (!normalized) return null;

    if (normalized === 'preview' || normalized.includes('preview')) {
        return 'preview';
    }
    if (
        normalized === 'development' ||
        normalized === 'dev' ||
        normalized.endsWith('dev') ||
        normalized.includes('development')
    ) {
        return 'development';
    }
    if (
        normalized === 'production' ||
        normalized === 'prod' ||
        normalized === 'stable' ||
        normalized.includes('production') ||
        normalized.includes('stable')
    ) {
        return 'production';
    }

    return null;
}

export function resolveExpoReleaseChannel(input: {
    updatesReleaseChannel?: unknown;
    updatesChannel?: unknown;
    manifestReleaseChannel?: unknown;
    expoConfigReleaseChannel?: unknown;
}): string | null {
    return (
        toNonEmptyString(input.updatesReleaseChannel) ??
        toNonEmptyString(input.updatesChannel) ??
        toNonEmptyString(input.manifestReleaseChannel) ??
        toNonEmptyString(input.expoConfigReleaseChannel) ??
        null
    );
}

export function resolveAppVariant(input: {
    appVariant?: unknown;
    updatesReleaseChannel?: unknown;
    updatesChannel?: unknown;
    manifestReleaseChannel?: unknown;
    expoConfigReleaseChannel?: unknown;
    envAppEnv?: unknown;
    envExpoPublicAppEnv?: unknown;
}): AppVariant | null {
    const releaseChannel = resolveExpoReleaseChannel({
        updatesReleaseChannel: input.updatesReleaseChannel,
        updatesChannel: input.updatesChannel,
        manifestReleaseChannel: input.manifestReleaseChannel,
        expoConfigReleaseChannel: input.expoConfigReleaseChannel,
    });

    return (
        normalizeAppVariant(input.appVariant) ??
        normalizeAppVariant(releaseChannel) ??
        normalizeAppVariant(input.envAppEnv) ??
        normalizeAppVariant(input.envExpoPublicAppEnv) ??
        null
    );
}
