import { createHappierCollectionVisitMemory } from '@happier-dev/plugin-ui/presentation';

/** The machine last opened in the Machines collection during this app session; a wide collection lands on it. */
const machineVisits = createHappierCollectionVisitMemory<Readonly<{ machineId: string; serverId: string }>>();

export const recordMachineCollectionVisit = machineVisits.record;
export const readLastVisitedMachine = machineVisits.read;
