import * as React from 'react';

import { PromptCollectionLayout } from '@/components/settings/prompts/collection/PromptCollectionList';

/** `/settings/prompts/templates`: the collection beside the selected item's editor. */
export default React.memo(function PromptTemplatesCollectionLayoutRoute() {
    return <PromptCollectionLayout kind="template" />;
});
