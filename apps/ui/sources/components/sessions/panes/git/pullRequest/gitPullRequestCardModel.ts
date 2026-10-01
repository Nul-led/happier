import type { ScmWorkingSnapshot } from '@/sync/domains/state/storageTypes';

import type { GitPullRequestCardModel } from './GitPullRequestCard';
import { resolveGitPullRequestProvider } from './GitPullRequestProviderMark';

/**
 * The branch's pull request card: the snapshot's open pull request is the truth (state, title, checks); a pull
 * request created a moment ago shows from the create result until the next status read carries it.
 */
export function resolveGitPullRequestCardModel(
    snapshot: ScmWorkingSnapshot | null,
    justCreated: Readonly<{ number: number | null; url: string; title: string; base: string }> | null,
): Readonly<{ model: GitPullRequestCardModel; source: 'snapshot' | 'just-created' }> | null {
    const provider = resolveGitPullRequestProvider(snapshot);
    const open = snapshot?.pullRequestStatus?.openPullRequest ?? null;
    if (open) {
        return {
            source: 'snapshot',
            model: {
                number: open.number ?? null,
                url: open.url,
                title: open.title,
                base: open.baseBranch,
                state: open.isDraft && open.state === 'open' ? 'draft' : open.state,
                checks: open.checks?.state ?? null,
                providerKind: open.provider.kind,
                providerName: open.provider.displayName,
            },
        };
    }
    if (!justCreated) return null;
    return {
        source: 'just-created',
        model: {
            number: justCreated.number,
            url: justCreated.url,
            title: justCreated.title,
            base: justCreated.base,
            state: 'open',
            checks: null,
            providerKind: provider.kind,
            providerName: provider.displayName,
        },
    };
}
