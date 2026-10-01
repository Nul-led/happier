import * as React from 'react';

import { SurfaceStateCard } from '@/components/ui/surfaces/SurfaceStateCard';

import { FilesystemBrowserList } from './FilesystemBrowserList';
import type { FilesystemBrowserListProps } from './filesystemBrowserTypes';
import type { IconName } from '@/components/ui/icons/Icon';

export type FilesystemBrowserProps = FilesystemBrowserListProps & Readonly<{
    loadingTestID?: string;
    errorTestID?: string;
    emptyTestID?: string;
    emptyLabel: string;
    emptyIconName?: IconName;
    loadingLabelCentered?: string;
    retryLabel?: string;
}>;

export function FilesystemBrowser(props: FilesystemBrowserProps): React.ReactElement {
    const retryLabel = props.retryLabel ?? props.inlineRetryLabel;
    const centeredLoadingLabel = props.loadingLabelCentered ?? props.loadingLabel;

    // The browser's root states are the shared state composition, sized by the pane or modal around it.
    if (props.rootLoading && props.nodes.length === 0) {
        return <SurfaceStateCard testID={props.loadingTestID} kind="loading" title={centeredLoadingLabel} />;
    }

    if (props.rootError && props.nodes.length === 0) {
        return (
            <SurfaceStateCard
                testID={props.errorTestID}
                kind="error"
                title={props.rootError}
                action={{ label: retryLabel, onPress: () => { void props.retryRoot(); } }}
            />
        );
    }

    if (props.nodes.length === 0) {
        return (
            <SurfaceStateCard
                testID={props.emptyTestID}
                kind="empty"
                iconName={props.emptyIconName ?? 'folder'}
                title={props.emptyLabel}
            />
        );
    }

    return <FilesystemBrowserList {...props} />;
}
