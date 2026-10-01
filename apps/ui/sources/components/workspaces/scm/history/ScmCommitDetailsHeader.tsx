import * as React from 'react';

import { DetailsTabHeader, type DetailsTabHeaderMetaFact } from '@/components/appShell/panes/details/header/DetailsTabHeader';
import { IconButton } from '@/components/ui/buttons/IconButton';
import { SurfaceFreshnessLine } from '@/components/ui/surfaces/SurfaceFreshnessLine';
import type { ScmCommitLogEntryState } from '@/scm/history/useScmCommitLogEntry';
import { formatScmHistoryTimestamp } from '@/scm/history/historyPresentation';
import { t } from '@/text';
import { setClipboardStringSafe } from '@/utils/ui/clipboard';

const SHORT_SHA_LENGTH = 7;

/**
 * A commit's Details header (details lab 2, CM): the commit is its message — the subject as the
 * title, who made it and when, the short SHA to copy, then the body. Shared by the Session and the
 * project commit views so a commit reads the same wherever it is opened.
 */
export const ScmCommitDetailsHeader = React.memo(function ScmCommitDetailsHeader(props: Readonly<{
    sha: string;
    commit: ScmCommitLogEntryState;
    /** Quiet view controls for the stream (split, wrap). */
    actions?: React.ReactNode;
    /** An SCM operation running on this repository ("revert"). */
    runningOperation?: string | null;
    testID?: string;
}>) {
    const entry = props.commit.entry;
    const shortSha = entry?.shortSha?.trim() || props.sha.slice(0, SHORT_SHA_LENGTH);
    const copySha = React.useCallback(() => {
        void setClipboardStringSafe(entry?.sha ?? props.sha);
    }, [entry?.sha, props.sha]);

    const meta = React.useMemo((): DetailsTabHeaderMetaFact[] => {
        const facts: DetailsTabHeaderMetaFact[] = [];
        if (entry?.authorName) facts.push({ key: 'author', text: entry.authorName, tone: 'strong' });
        const when = entry ? formatScmHistoryTimestamp(entry.timestamp) : '';
        if (when) facts.push({ key: 'when', text: when });
        facts.push({ key: 'sha', text: shortSha, tone: 'mono', testID: 'scm-commit-details-short-sha' });
        return facts;
    }, [entry, shortSha]);

    const body = entry?.body?.trim() ? entry.body.trim() : undefined;

    return (
        <DetailsTabHeader
            testID={props.testID ?? 'scm-commit-details-header'}
            title={entry?.subject?.trim() || shortSha}
            meta={meta}
            body={body}
            actions={(
                <>
                    <IconButton
                        variant="plain"
                        size={28}
                        iconSize={14}
                        iconName="copy"
                        onPress={copySha}
                        accessibilityLabel={t('detailsSurface.history.copyCommitSha')}
                        tooltip={t('detailsSurface.history.copyCommitSha')}
                        testID="scm-commit-details-copy-sha"
                    />
                    {props.actions}
                </>
            )}
            notice={props.runningOperation ? (
                <SurfaceFreshnessLine
                    testID="scm-commit-details-running"
                    reason={t('files.commitDetails.running', { operation: props.runningOperation })}
                    busy
                />
            ) : null}
        />
    );
});
