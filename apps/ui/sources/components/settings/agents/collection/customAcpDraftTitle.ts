import { createHappierCollectionDraftTitleStore } from '@happier-dev/plugin-ui/presentation';

/** The name typed into the open new-ACP-agent draft, shown by the collection's draft row. */
export const customAcpDraftTitle = createHappierCollectionDraftTitleStore();

export const publishCustomAcpDraftTitle = customAcpDraftTitle.publish;
