import { Platform } from 'react-native';

import {
    resolveEndpointReachabilityRemediation,
    type EndpointReachabilityRemediation,
} from '@/components/serverReachability/remediation';
import { probeServerFeaturesAtUrl } from '@/sync/api/capabilities/serverFeaturesClient';
import {
    adoptHomeProfile,
    defaultHomeNameForAddress,
    resolveServerProfileForPortableIdentity,
    type ServerProfile,
} from '@/sync/domains/server/serverProfiles';
import { canonicalizeServerUrl } from '@/sync/domains/server/url/serverUrlCanonical';
import { isInsecureRemoteHttpServerUrl } from '@/sync/domains/server/url/serverUrlClassification';
import { createEndpointReadinessProbe } from '@/sync/runtime/connectivity/createEndpointReadinessProbe';
import { readServerReachabilityProbeTimeoutMs } from '@/sync/runtime/connectivity/serverReachabilityTuning';
import { isDesktopHost } from '@/utils/platform/desktopHost';

export type ConnectHomeAtAddressInput = Readonly<{
    serverUrl: string;
    displayName?: string;
    source?: 'manual' | 'url' | 'notification';
    signal?: AbortSignal;
    confirmInsecureHttp: () => Promise<boolean>;
    confirmCanonicalUrl: () => Promise<boolean>;
}>;

export type ConnectHomeAtAddressResult =
    | Readonly<{ kind: 'invalid_address' | 'declined' | 'mixed_content' }>
    | Readonly<{ kind: 'unreachable'; remediation: EndpointReachabilityRemediation | null }>
    | Readonly<{ kind: 'connected'; profile: ServerProfile }>;

function throwIfAborted(signal: AbortSignal | undefined): void {
    if (!signal?.aborted) return;
    const error = new Error('Home connection cancelled');
    error.name = 'AbortError';
    throw error;
}

/**
 * Connects a manually entered or supplied Home address without changing device focus. Every
 * check and confirmation finishes before profile adoption, which is the single commit point.
 * Once adoption begins it is not cancellable; a successful commit is always reported as connected.
 */
export async function connectHomeAtAddress(input: ConnectHomeAtAddressInput): Promise<ConnectHomeAtAddressResult> {
    throwIfAborted(input.signal);
    const enteredUrl = canonicalizeServerUrl(input.serverUrl);
    if (!enteredUrl) return { kind: 'invalid_address' };

    if (isInsecureRemoteHttpServerUrl(enteredUrl)) {
        const accepted = await input.confirmInsecureHttp();
        throwIfAborted(input.signal);
        if (!accepted) return { kind: 'declined' };
    }

    const readiness = await createEndpointReadinessProbe({
        endpoint: enteredUrl,
        token: null,
        timeoutMs: readServerReachabilityProbeTimeoutMs(),
        ...(input.signal ? { signal: input.signal } : {}),
    })();
    throwIfAborted(input.signal);
    if (readiness.status === 'retry_later' && readiness.blockedBy === 'mixed_content') {
        return { kind: 'mixed_content' };
    }
    if (readiness.status !== 'ready') {
        return {
            kind: 'unreachable',
            remediation: resolveEndpointReachabilityRemediation({
                endpointUrl: enteredUrl,
                readiness,
                platformOs: Platform.OS,
                isDesktopShell: isDesktopHost(),
            }),
        };
    }

    const snapshot = await probeServerFeaturesAtUrl({
        endpointUrl: enteredUrl,
        ...(input.signal ? { signal: input.signal } : {}),
    });
    throwIfAborted(input.signal);
    if (snapshot.status !== 'ready') return { kind: 'unreachable', remediation: null };
    const advertisedUrl = canonicalizeServerUrl(snapshot.features.capabilities.server?.canonicalServerUrl ?? '');
    const learnedIdentity = snapshot.serverIdentityId
        ?? snapshot.features.capabilities.serverIdentity?.serverIdentityId
        ?? undefined;

    let canonicalServerUrl: string | undefined;
    if (advertisedUrl && advertisedUrl !== enteredUrl) {
        const accepted = await input.confirmCanonicalUrl();
        throwIfAborted(input.signal);
        if (accepted) canonicalServerUrl = advertisedUrl;
    } else if (advertisedUrl) {
        canonicalServerUrl = advertisedUrl;
    }

    if (canonicalServerUrl && canonicalServerUrl !== enteredUrl && isInsecureRemoteHttpServerUrl(canonicalServerUrl)) {
        const accepted = await input.confirmInsecureHttp();
        throwIfAborted(input.signal);
        if (!accepted) canonicalServerUrl = undefined;
    }

    throwIfAborted(input.signal);
    if (!canonicalServerUrl && learnedIdentity) {
        const existing = resolveServerProfileForPortableIdentity(learnedIdentity);
        if (existing.kind === 'resolved' && existing.profile.homeConnectionDescriptor) {
            // Keeping the entered URL grants no authority to replace a revisioned
            // descriptor. Continue with the established Home unchanged instead.
            return { kind: 'connected', profile: existing.profile };
        }
    }
    const saved = await adoptHomeProfile({
        descriptor: {
            serverUrl: enteredUrl,
            ...(canonicalServerUrl ? { canonicalServerUrl } : {}),
            displayName: input.displayName?.trim() || defaultHomeNameForAddress(enteredUrl),
            ...(learnedIdentity ? { homeServerIdentityId: learnedIdentity } : {}),
        },
        source: input.source ?? 'manual',
        preserveUserLabel: true,
    });
    return { kind: 'connected', profile: saved };
}
