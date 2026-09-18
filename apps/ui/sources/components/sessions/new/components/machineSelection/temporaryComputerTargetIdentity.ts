import type { RunnerArtifactTarget } from '@happier-dev/protocol/ephemeralRunner/runnerArtifact';

/** Cannot occur inside a Home id or an artifact target, so the join is unambiguous. */
const IDENTITY_SEPARATOR = '\u0000';

/**
 * The one identity for "which Temporary-computer destination is this" inside the
 * picker's own state.
 *
 * A Home id and an artifact target are two independent strings, so any ad-hoc
 * join is a chance for the writer and the reader to disagree. They already did:
 * pending expiry was stored under one separator and read back under another, so
 * an explicitly chosen expiry was silently dropped on commit. The separator here
 * also makes the identity unusable as a DOM or SelectionList id, which is exactly
 * why {@link temporaryComputerTargetOptionKey} exists beside it.
 */
export function temporaryComputerTargetIdentity(
    serverId: string,
    artifactTarget: RunnerArtifactTarget,
): string {
    return `${serverId}${IDENTITY_SEPARATOR}${artifactTarget}`;
}

/**
 * The rendered id segment for one destination's rows and steps.
 *
 * Separate from the state identity on purpose: option ids reach the DOM, test
 * ids and accessibility tooling, so they stay printable. They are never used to
 * look state up.
 */
export function temporaryComputerTargetOptionKey(
    serverId: string,
    artifactTarget: RunnerArtifactTarget,
): string {
    return `${serverId}:${artifactTarget}`;
}
