import * as React from 'react';

import { storage, useActiveServerAccountScope, useSession, useSetting } from '@/sync/domains/state/storage';
import { areServerProfileIdentifiersEquivalent } from '@/sync/domains/server/serverProfiles';
import { sync } from '@/sync/sync';
import { resolveMachineForActiveServerFromState } from '@/sync/store/domains/machines/resolveMachinesForActiveServerFromState';
import { useVoiceExecutionMachinePresentation } from '@/voice/credentials/useExecutionMachinePresentation';
import { resolveVoiceProviderIdForBindingScope } from '@/voice/settings/resolveVoiceProviderId';
import { getVoiceAdapterRegistry, resolveVoiceAdapterContextChannel } from '@/voice/session/voiceAdapterRegistry';
import { useVoiceSessionSnapshot } from '@/voice/session/voiceSession';
import { voiceSettingsParse } from '@/sync/domains/settings/voiceSettings';

import { resolveAccountVoiceFollowReadiness, type AccountVoiceFollowReadiness } from './accountVoiceFollowReadiness';

export function useAccountVoiceFollowReadiness(input: Readonly<{
    sessionId: string;
    serverId: string;
    initialSnapshotPending: boolean;
}>): AccountVoiceFollowReadiness {
    // Voice readiness is Home-scoped. A bare Session id can resolve whichever
    // Home hydrated that id last and must never decide encryption readiness for
    // the Home whose Follow editor is open.
    const session = useSession(input.sessionId, input.serverId);
    const activeScope = useActiveServerAccountScope();
    const voice = useSetting('voice');
    const voiceSettings = voiceSettingsParse(voice);
    const snapshot = useVoiceSessionSnapshot();
    const executionMachine = useVoiceExecutionMachinePresentation();
    const [, setRegistryRevision] = React.useState(0);

    React.useEffect(() => getVoiceAdapterRegistry().subscribe?.(() => {
        setRegistryRevision((revision) => revision + 1);
    }), []);

    const adapterId = (snapshot.status === 'connected' || snapshot.status === 'connecting')
        ? snapshot.adapterId
        : resolveVoiceProviderIdForBindingScope(voiceSettings, 'session');
    const contextScope = adapterId
        ? resolveVoiceAdapterContextChannel(adapterId, voiceSettings)?.hostAuthoredContext ?? null
        : null;
    const machine = storage((state) => executionMachine.machineId
        ? resolveMachineForActiveServerFromState(state, executionMachine.machineId)
        : null);
    const scopeCurrent = activeScope !== null
        && areServerProfileIdentifiersEquivalent(activeScope.serverId, input.serverId);
    if (!session) return 'waiting_for_runtime';

    const sourceEncrypted = session.encryptionMode !== 'plain';
    const sourceKeyReady = scopeCurrent
        && (!sourceEncrypted || (
            sync.encryption !== null
            && sync.encryption.getSessionEncryption(input.sessionId) !== null
        ));

    return resolveAccountVoiceFollowReadiness({
        scopeCurrent,
        adapterPresent: adapterId !== null,
        contextScope,
        machine: scopeCurrent ? machine : null,
        sourceEncrypted,
        sourceKeyReady,
        initialSnapshotPending: input.initialSnapshotPending,
    });
}
