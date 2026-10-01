import { createHappierCollectionDraftTitleStore } from '@happier-dev/plugin-ui/presentation';

/** The name typed into the open new-pool draft, shown by the Machines collection's draft row. */
export const machinePoolDraftTitle = createHappierCollectionDraftTitleStore();

export const publishMachinePoolDraftTitle = machinePoolDraftTitle.publish;
