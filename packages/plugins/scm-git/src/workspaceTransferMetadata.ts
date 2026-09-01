import type { ScmWorkspaceIntegrationWorkspaceTransferInput } from './types.js';

import { inspectGitCheckoutIdentity } from './checkoutIdentity.js';

export type GitWorkspaceTransferMetadata = Readonly<{
    provider: 'git';
    sessionRelativeCwd?: string;
    portableBundle?: Readonly<{
        v: 1;
        relativePath: '.happier-scm/git.bundle';
    }>;
}> & (
    Readonly<{
        checkoutKind: 'branch';
        branchName: string;
        headRevision?: string;
    }>
    | Readonly<{
        checkoutKind: 'detached';
        headRevision: string;
    }>
);

export function isGitWorkspaceTransferMetadata(value: unknown): value is GitWorkspaceTransferMetadata {
    if (!value || typeof value !== 'object') {
        return false;
    }

    const candidate = value as Partial<GitWorkspaceTransferMetadata> & {
        checkoutKind?: string;
        branchName?: string;
        headRevision?: string;
    };
    if (candidate.provider !== 'git') {
        return false;
    }
    const portableBundle = (candidate as { portableBundle?: unknown }).portableBundle;
    if (portableBundle !== undefined && (
        !portableBundle
        || typeof portableBundle !== 'object'
        || (portableBundle as { v?: unknown }).v !== 1
        || (portableBundle as { relativePath?: unknown }).relativePath !== '.happier-scm/git.bundle'
    )) {
        return false;
    }
    if (candidate.sessionRelativeCwd !== undefined && typeof candidate.sessionRelativeCwd !== 'string') {
        return false;
    }

    if (candidate.checkoutKind === 'branch') {
        return typeof candidate.branchName === 'string'
            && candidate.branchName.trim().length > 0
            && (candidate.headRevision == null || /^[0-9a-f]{40}$/i.test(candidate.headRevision));
    }

    if (candidate.checkoutKind === 'detached') {
        return typeof candidate.headRevision === 'string'
            && /^[0-9a-f]{40}$/i.test(candidate.headRevision);
    }

    return false;
}

export async function resolveGitWorkspaceTransferMetadata(
    input: ScmWorkspaceIntegrationWorkspaceTransferInput,
): Promise<GitWorkspaceTransferMetadata | null> {
    const identity = await inspectGitCheckoutIdentity({ cwd: input.context.cwd });
    if (!identity?.headRevision && !identity?.branchName) {
        return null;
    }

    if (!identity.branchName) {
        if (!identity.headRevision) {
            return null;
        }

        return {
            provider: 'git',
            checkoutKind: 'detached',
            headRevision: identity.headRevision,
        };
    }

    return {
        provider: 'git',
        checkoutKind: 'branch',
        branchName: identity.branchName,
        ...(identity.headRevision ? { headRevision: identity.headRevision } : {}),
    };
}
