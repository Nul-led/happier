import { createHappierCollectionDraftTitleStore } from '@happier-dev/plugin-ui/presentation';

/** The name typed into the open new-provider draft, shown by the collection's draft row. */
export const providerDraftTitle = createHappierCollectionDraftTitleStore();

export const publishProviderDraftTitle = providerDraftTitle.publish;
