import * as React from 'react';
import { useUnistyles } from 'react-native-unistyles';

import { Icon } from '@/components/ui/icons/Icon';
import type { ScmWorkingSnapshot } from '@/sync/domains/state/storageTypes';

export type GitPullRequestProvider = Readonly<{ kind: string | null; displayName: string }>;

/** The hosting provider the session's pull requests go to, from the snapshot's PR status (then its hosting ref). */
export function resolveGitPullRequestProvider(snapshot: ScmWorkingSnapshot | null): GitPullRequestProvider {
    const provider = snapshot?.pullRequestStatus?.provider
        ?? snapshot?.pullRequestStatus?.openPullRequest?.provider
        ?? null;
    if (provider) return { kind: provider.kind, displayName: provider.displayName };
    const hosting = snapshot?.hostingProvider ?? null;
    return { kind: hosting?.kind ?? null, displayName: hosting?.displayName ?? '' };
}

/** The provider's mark, standing on its own (no tile); a generic pull request mark when there is no brand glyph. */
export const GitPullRequestProviderMark = React.memo(function GitPullRequestProviderMark(props: Readonly<{ kind: string | null; size?: number }>) {
    const { theme } = useUnistyles();
    const size = props.size ?? 16;
    return (
        <Icon
            name={props.kind === 'github' ? 'github-logo' : 'git-pull-request'}
            size={size}
            color={theme.colors.text.primary}
        />
    );
});
