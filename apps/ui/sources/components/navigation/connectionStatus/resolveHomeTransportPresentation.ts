import type { IrohObservedPath, IrohRelayPolicy } from '@happier-dev/iroh-native';

import type { TranslationKeyNoParams } from '@/text';

export type HomeTransportPresentation = Readonly<{
    pathLabelKey: TranslationKeyNoParams;
    modeLabelKey: TranslationKeyNoParams;
}>;

/**
 * Pure presentation of the active Home's already-verified transport facts.
 * Direct/relay is native telemetry only; HTTPS and absent runtime publications
 * remain the ordinary standard connection and never imply native availability.
 */
export function resolveHomeTransportPresentation(snapshot: Readonly<{
    carrier?: 'https' | 'iroh';
    irohObservedPath?: IrohObservedPath;
    irohRelayPolicy?: IrohRelayPolicy;
}>): HomeTransportPresentation {
    if (snapshot.carrier !== 'iroh') {
        return {
            pathLabelKey: 'connectionStatus.transport.standard',
            modeLabelKey: 'connectionStatus.transport.standard',
        };
    }

    const pathLabelKey: TranslationKeyNoParams = snapshot.irohObservedPath === 'direct'
        ? 'connectionStatus.transport.direct'
        : snapshot.irohObservedPath === 'relay'
            ? 'connectionStatus.transport.secureRelay'
            : 'status.connected';
    return {
        pathLabelKey,
        modeLabelKey: snapshot.irohRelayPolicy === 'disabled'
            ? 'connectionStatus.transport.directOnly'
            : 'connectionStatus.transport.automatic',
    };
}
