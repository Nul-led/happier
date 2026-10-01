import * as React from 'react';
import { resolveFilesystemErrorReason } from '@/components/ui/filesystemBrowser/filesystemErrorReason';
import { SurfaceStateCard } from '@/components/ui/surfaces/SurfaceStateCard';
import { t } from '@/text';

/** Root directory failures are filesystem failures, not SCM-unavailable states. */
export function RepositoryTreeRootErrorState(props: Readonly<{
    error: string;
    /** The machine the files live on, so the title says where the listing failed. */
    machineName?: string | null;
    onRetry: () => void;
}>) {
    const reason = resolveFilesystemErrorReason(props.error);

    return <SurfaceStateCard
        testID="repository-tree-root-error"
        kind="error"
        iconName="folder"
        title={props.machineName
            ? t('files.pane.rootErrorTitle', { machine: props.machineName })
            : t('files.pane.rootErrorTitleUnnamed')}
        reason={reason}
        diagnosticCode={props.error}
        action={{ label: t('common.retry'), onPress: props.onRetry }}
    />;
}
