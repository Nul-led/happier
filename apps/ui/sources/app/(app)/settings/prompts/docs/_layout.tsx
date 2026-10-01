import * as React from 'react';

import { PromptCollectionLayout } from '@/components/settings/prompts/collection/PromptCollectionList';

/** `/settings/prompts/docs`: the collection beside the selected item's editor. */
export default React.memo(function PromptDocsCollectionLayoutRoute() {
    return <PromptCollectionLayout kind="doc" />;
});
