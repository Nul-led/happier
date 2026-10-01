import type { DaemonProviderModelProjectionGroupV1 } from '@happier-dev/protocol/rpc';

/**
 * How a provider connection is named next to one of its models: the provider alone for its
 * automatically named default connection, otherwise "Provider · Connection".
 */
export function providerModelConnectionTitle(group: Pick<
    DaemonProviderModelProjectionGroupV1,
    'providerName' | 'connectionName' | 'connectionRole' | 'connectionDisplayNameMode'
>): string {
    return group.connectionRole === 'default' && group.connectionDisplayNameMode === 'automatic'
        ? group.providerName
        : `${group.providerName} · ${group.connectionName}`;
}
