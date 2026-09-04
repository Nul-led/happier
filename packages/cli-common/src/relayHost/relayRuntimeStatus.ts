import type { SystemTaskResult } from '@happier-dev/protocol';

export type RelayRuntimeStatusData = Readonly<{
    channel: 'stable' | 'preview' | 'dev';
    mode: 'user' | 'system';
    installed: boolean;
    dataPresent: boolean;
    version: string | null;
    relayUrl: string;
    healthy: boolean;
    purpose: Readonly<{ kind: 'personal-home'; canonicalServerUrl: string }>
        | Readonly<{ kind: 'generic' }>
        | null;
    anonymousSignupEnabled: boolean | null;
    service: Readonly<{
        active: boolean | null;
        enabled: boolean | null;
    }>;
}>;

function readLoopbackHttpOrigin(value: unknown): string | null {
    if (typeof value !== 'string' || !value.trim()) return null;
    try {
        const parsed = new URL(value.trim());
        const hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/gu, '');
        const port = Number(parsed.port);
        if (
            parsed.protocol !== 'http:'
            || (hostname !== '127.0.0.1' && hostname !== 'localhost' && hostname !== '::1')
            || !Number.isInteger(port)
            || port < 1
            || port > 65_535
            || parsed.username
            || parsed.password
            || parsed.pathname !== '/'
            || parsed.search
            || parsed.hash
        ) {
            return null;
        }
        return parsed.origin;
    } catch {
        return null;
    }
}

/** Canonical strict decoder for relay-runtime task results consumed by every host. */
export function readRelayRuntimeStatusData(
    result: SystemTaskResult | null,
): RelayRuntimeStatusData | null {
    if (!result?.ok) return null;

    const data = result.data && typeof result.data === 'object' && !Array.isArray(result.data)
        ? result.data as Record<string, unknown>
        : null;
    const relayUrl = readLoopbackHttpOrigin(data?.relayUrl);
    const service = data?.service;
    if (
        !relayUrl
        || typeof data?.dataPresent !== 'boolean'
        || !service
        || typeof service !== 'object'
        || Array.isArray(service)
    ) return null;

    const serviceRecord = service as Record<string, unknown>;
    const purposeValue = data?.purpose;
    const purposeRecord = purposeValue && typeof purposeValue === 'object' && !Array.isArray(purposeValue)
        ? purposeValue as Record<string, unknown>
        : null;
    let purpose: RelayRuntimeStatusData['purpose'] = null;
    if (purposeValue != null) {
        if (!purposeRecord) return null;
        if (purposeRecord.kind === 'personal-home') {
            const canonicalServerUrl = readLoopbackHttpOrigin(purposeRecord.canonicalServerUrl);
            const projectedCanonicalServerUrl = data?.canonicalServerUrl == null
                ? canonicalServerUrl
                : readLoopbackHttpOrigin(data.canonicalServerUrl);
            if (
                !canonicalServerUrl
                || projectedCanonicalServerUrl !== canonicalServerUrl
                || canonicalServerUrl !== relayUrl
            ) {
                return null;
            }
            purpose = { kind: 'personal-home', canonicalServerUrl };
        } else if (purposeRecord.kind === 'generic') {
            if (data?.canonicalServerUrl != null) return null;
            purpose = { kind: 'generic' };
        } else {
            return null;
        }
    } else if (data?.canonicalServerUrl != null) {
        return null;
    }

    return {
        channel: data?.channel === 'preview' || data?.channel === 'dev' ? data.channel : 'stable',
        mode: data?.mode === 'system' ? 'system' : 'user',
        installed: data?.installed === true,
        dataPresent: data.dataPresent,
        version: typeof data?.version === 'string' ? data.version : null,
        relayUrl,
        healthy: data?.healthy === true,
        purpose,
        anonymousSignupEnabled: typeof data?.anonymousSignupEnabled === 'boolean'
            ? data.anonymousSignupEnabled
            : null,
        service: {
            active: typeof serviceRecord.active === 'boolean' ? serviceRecord.active : null,
            enabled: typeof serviceRecord.enabled === 'boolean' ? serviceRecord.enabled : null,
        },
    };
}
