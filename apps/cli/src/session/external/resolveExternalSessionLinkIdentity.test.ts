import { describe, expect, it } from 'vitest';

import type { ExternalSessionsSource, RuntimeDescriptorV1 } from '@happier-dev/protocol';

import { resolveExternalSessionLinkIdentityFromSurface } from './resolveExternalSessionLinkIdentity';
import {
    isExternalSessionProviderFailureError,
    type ExternalSessionExecutionSurface,
} from './providerOps';

const SOURCE = { kind: 'codexHome', home: 'user' } as unknown as ExternalSessionsSource;

function descriptorFor(agentId: string): RuntimeDescriptorV1 {
    return { v: 1, agentId, agent: {} } as RuntimeDescriptorV1;
}

function surfaceReturning(runtimeDescriptor: RuntimeDescriptorV1 | null): ExternalSessionExecutionSurface {
    return {
        async resolveLinkIdentity() {
            return {
                remoteSessionId: 'remote-1',
                source: SOURCE,
                runtimeDescriptor,
            };
        },
    };
}

describe('resolveExternalSessionLinkIdentityFromSurface', () => {
    it('refuses a runtime descriptor that names an Agent other than the admitted one', async () => {
        await expect(resolveExternalSessionLinkIdentityFromSurface(
            { agentId: 'codex', remoteSessionId: 'remote-1', source: SOURCE },
            surfaceReturning(descriptorFor('claude')),
        )).rejects.toSatisfy((error: unknown) => (
            isExternalSessionProviderFailureError(error)
            && error.code === 'source_invalid'
            && error.operation === 'resolveLinkIdentity'
        ));
    });

    it('keeps a runtime descriptor that belongs to the admitted Agent', async () => {
        const identity = await resolveExternalSessionLinkIdentityFromSurface(
            { agentId: 'codex', remoteSessionId: 'remote-1', source: SOURCE },
            surfaceReturning(descriptorFor('codex')),
        );

        expect(identity.runtimeDescriptor?.agentId).toBe('codex');
    });

    it('admits a resolution that carries no runtime descriptor', async () => {
        const identity = await resolveExternalSessionLinkIdentityFromSurface(
            { agentId: 'codex', remoteSessionId: 'remote-1', source: SOURCE },
            surfaceReturning(null),
        );

        expect(identity.runtimeDescriptor).toBeNull();
    });
});
