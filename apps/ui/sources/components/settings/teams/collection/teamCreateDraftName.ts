import { createHappierCollectionDraftTitleStore } from '@happier-dev/plugin-ui/presentation';

/** The name typed into the open new-Team draft, shown by the Teams collection's draft row. */
export const teamCreateDraftName = createHappierCollectionDraftTitleStore();

export const publishTeamCreateDraftName = teamCreateDraftName.publish;
