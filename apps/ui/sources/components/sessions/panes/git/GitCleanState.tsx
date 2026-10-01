import * as React from 'react';

import { SurfaceStateCard } from '@/components/ui/surfaces/SurfaceStateCard';
import { formatScmTimelineWhen } from '@/scm/history/historyPresentation';
import { t } from '@/text';

/**
 * Git lab ST "Clean and up to date" / SX "All clean": an empty change list is a finished state, not an
 * apology. It says what is true (everything committed; pushed when origin matches), and offers one next step
 * the system can back: create a pull request, or open the one that exists.
 */
export const GitCleanState = React.memo(function GitCleanState(props: Readonly<{
    branch: string | null;
    upstream: string | null;
    ahead: number;
    behind: number;
    lastCommitAt: number | null;
    onCreatePullRequest: (() => void) | null;
    onOpenPullRequest: (() => void) | null;
    pullRequestNumber: number | null;
}>) {
    const upToDate = Boolean(props.upstream) && props.ahead === 0 && props.behind === 0;
    const title = upToDate ? t('sessionGitPane.flow.clean.titleUpToDate') : t('sessionGitPane.flow.clean.titleCommitted');
    const reason = upToDate && props.branch && props.upstream
        ? t('sessionGitPane.flow.clean.bodyUpToDate', { branch: props.branch, upstream: props.upstream })
        : t('sessionGitPane.flow.clean.body');
    const action = props.onOpenPullRequest && props.pullRequestNumber
        ? { label: t('sessionGitPane.flow.clean.openPullRequest', { number: String(props.pullRequestNumber) }), onPress: props.onOpenPullRequest }
        : props.onCreatePullRequest
            ? { label: t('sessionGitPane.flow.clean.createPullRequest'), onPress: props.onCreatePullRequest }
            : undefined;
    return (
        <SurfaceStateCard
            testID="session-git-clean"
            kind="success"
            title={title}
            reason={reason}
            {...(action ? { action } : {})}
            {...(props.lastCommitAt ? { live: { text: t('sessionGitPane.flow.clean.lastCommit', { when: formatScmTimelineWhen(props.lastCommitAt) }) } } : {})}
        />
    );
});
