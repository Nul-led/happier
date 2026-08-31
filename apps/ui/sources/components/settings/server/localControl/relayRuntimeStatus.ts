import type { SystemTaskResult } from '@happier-dev/protocol';

export type RelayRuntimeStatusData = Readonly<{
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

/** Canonical UI decoder for relay-runtime task results consumed by settings and bootstrap. */
export function readRelayRuntimeStatusData(
    result: SystemTaskResult | null,
    options: Readonly<{ fallbackRelayUrl?: string }> = {},
): RelayRuntimeStatusData | null {
    if (!result?.ok) return null;

    const data = result.data && typeof result.data === 'object' && !Array.isArray(result.data)
        ? result.data as Record<string, unknown>
        : null;
    const relayUrl = typeof data?.relayUrl === 'string' && data.relayUrl.trim()
        ? data.relayUrl.trim()
        : String(options.fallbackRelayUrl ?? '').trim();
    const service = data?.service;
    if (!relayUrl || !service || typeof service !== 'object' || Array.isArray(service)) return null;

    const serviceRecord = service as Record<string, unknown>;
    const purposeValue = data?.purpose;
    const purposeRecord = purposeValue && typeof purposeValue === 'object' && !Array.isArray(purposeValue)
        ? purposeValue as Record<string, unknown>
        : null;
    const canonicalServerUrl = typeof purposeRecord?.canonicalServerUrl === 'string'
        ? purposeRecord.canonicalServerUrl.trim()
        : '';
    const purpose = purposeRecord?.kind === 'personal-home' && canonicalServerUrl
        ? { kind: 'personal-home' as const, canonicalServerUrl }
        : purposeRecord?.kind === 'generic'
            ? { kind: 'generic' as const }
            : null;

    return {
        installed: data?.installed === true,
        dataPresent: data?.dataPresent === true,
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
