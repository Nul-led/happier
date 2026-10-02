import * as React from 'react';

import {
    BUNDLED_LEGACY_CONNECTED_ACCOUNT_COMPATIBILITY_BY_SERVICE_ID,
    assertConnectedAccountOperationTransportV1,
    type BuiltInLegacyConnectedAccountOperation,
    type ConnectedServiceId,
    type PluginContributionIdentityV1,
    type ConnectedAccountExpectedOperationTransport,
} from '@happier-dev/protocol';

import { useActiveServerSnapshot } from '@/hooks/server/useActiveServerSnapshot';
import {
    runConnectedAccountControlCommand,
} from '@/sync/ops/connectedAccounts/connectedAccountDaemon';
import { useAllMachines } from '@/sync/store/hooks';

function resolveQualifiedService(
    serviceId: ConnectedServiceId,
): PluginContributionIdentityV1 | null {
    const compatibility =
        BUNDLED_LEGACY_CONNECTED_ACCOUNT_COMPATIBILITY_BY_SERVICE_ID[
            serviceId
        ];
    return compatibility?.service ?? null;
}

function admissionError(code: string): Error & Readonly<{ code: string }> {
    return Object.assign(new Error(code), { code });
}

export type { ConnectedAccountExpectedOperationTransport } from '@happier-dev/protocol';

export function useConnectedAccountOperationAdmission(): (
    service: PluginContributionIdentityV1,
    expectedTransport: ConnectedAccountExpectedOperationTransport,
    operation: BuiltInLegacyConnectedAccountOperation,
) => Promise<void> {
    const activeServer = useActiveServerSnapshot();
    const machines = useAllMachines();
    const serverId = String(activeServer.serverId ?? '').trim();
    const activeServerGeneration = activeServer.generation;
    const machine = machines.find(
        (candidate) => candidate.active === true,
    ) ?? machines[0] ?? null;
    const machineId = machine?.id ?? '';

    return React.useCallback(async (
        service: PluginContributionIdentityV1,
        expectedTransport: ConnectedAccountExpectedOperationTransport,
        operation: BuiltInLegacyConnectedAccountOperation,
    ) => {
        if (!serverId || !machineId) {
            throw admissionError(
                'connected_account_service_identity_unsupported',
            );
        }
        const result = await runConnectedAccountControlCommand({
            serverId,
            machineId,
            expectedActiveServer: {
                serverId,
                generation: activeServerGeneration,
            },
            command: {
                operation: 'describeService',
                service,
                requiredOperation: operation,
            },
        });
        assertConnectedAccountOperationTransportV1(result, service, expectedTransport);
    }, [activeServerGeneration, machineId, serverId]);
}

export function useConnectedServiceLegacyOperationAdmission(): (
    serviceId: ConnectedServiceId,
    operation: BuiltInLegacyConnectedAccountOperation,
) => Promise<void> {
    const assertOperationAllowed = useConnectedAccountOperationAdmission();

    return React.useCallback(async (
        serviceId: ConnectedServiceId,
        operation: BuiltInLegacyConnectedAccountOperation,
    ) => {
        const service = resolveQualifiedService(serviceId);
        if (!service) {
            throw admissionError(
                'connected_account_service_identity_unsupported',
            );
        }
        await assertOperationAllowed(
            service,
            { kind: 'legacy', serviceId },
            operation,
        );
    }, [assertOperationAllowed]);
}
