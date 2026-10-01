import * as React from 'react';
import { TabBadge } from './TabBadge';
import { resolveGitTabBadge, type TabBarGitBadgeMode } from './tabBadgeModel';
import type { ScmStatus } from '@/sync/domains/state/storageTypes';

export function GitActionRailBadge(props: Readonly<{
    scmStatus: ScmStatus | null | undefined;
    mode: TabBarGitBadgeMode;
    testID?: string;
}>) {
    const badge = resolveGitTabBadge(props.mode, props.scmStatus);
    if (!badge) return null;
    return badge.kind === 'count'
        ? <TabBadge size="compact" variant="count" value={badge.value} tone="neutral" testID={props.testID} />
        : <TabBadge size="compact" variant="diff" added={badge.added} removed={badge.removed} changedFileCount={badge.changedFileCount} testID={props.testID} style={{ flexDirection: 'column', top: -4, left: -9, right: -9, height: 'auto' }} />;
}
