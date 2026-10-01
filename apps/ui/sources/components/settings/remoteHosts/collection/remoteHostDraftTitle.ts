import { createHappierCollectionDraftTitleStore } from '@happier-dev/plugin-ui/presentation';

/** The name typed into the open new-host draft, shown by the Remote hosts collection's draft row. */
export const remoteHostDraftTitle = createHappierCollectionDraftTitleStore();

export const publishRemoteHostDraftTitle = remoteHostDraftTitle.publish;
