import * as React from 'react';

import { resolveSessionMachineId } from '@/sync/domains/session/external/resolveSessionMachineId';
import { useMachineDisplayNamesById } from '@/sync/domains/state/storage';
import { t } from '@/text';

const NO_MACHINE_IDS: readonly string[] = Object.freeze([]);

/**
 * The machine a Run lives on, in the person's words: its display name, else the host the Session
 * recorded, else "this machine". The Run page says where it reads from and what a stop affects, so
 * it names the machine rather than a raw id.
 */
export function useExecutionRunMachineName(sessionMetadata: unknown): Readonly<{ machineId: string | null; name: string }> {
    const machineId = resolveSessionMachineId(sessionMetadata);
    const machineIds = React.useMemo(() => (machineId ? [machineId] : NO_MACHINE_IDS), [machineId]);
    const names = useMachineDisplayNamesById(machineIds);
    const host = sessionMetadata && typeof sessionMetadata === 'object'
        && typeof (sessionMetadata as { host?: unknown }).host === 'string'
        ? (sessionMetadata as { host: string }).host.trim()
        : '';
    const name = (machineId ? names[machineId] : undefined) || host || t('runPage.thisMachine');
    return { machineId, name };
}
