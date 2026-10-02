import * as React from 'react';

import { ItemList } from '@/components/ui/lists/ItemList';
import { useUpdatesContentModel } from '@/updates/useUpdatesContentModel';

import { UpdatesContent } from './UpdatesContent';

/** Settings › Updates: the full list, every row, in the page anatomy. */
export const UpdatesView = React.memo(function UpdatesView() {
    const model = useUpdatesContentModel();
    return (
        <ItemList style={{ paddingTop: 0 }} testID="updates-screen">
            <UpdatesContent model={model} presentation="screen" />
        </ItemList>
    );
});
