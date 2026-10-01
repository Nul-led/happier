import * as React from 'react';

import { PromptCollectionLayout } from '@/components/settings/prompts/collection/PromptCollectionList';

/** `/settings/prompts/skills`: the collection beside the selected item's editor. */
export default React.memo(function PromptSkillsCollectionLayoutRoute() {
    return <PromptCollectionLayout kind="bundle" />;
});
