import * as React from 'react';
import { bindHomeDomainActionHttpRequestV1 } from '@happier-dev/protocol/actions';
import {
    TeamInvitationPreviewResultV1Schema,
    type TeamInvitationPreviewV1,
} from '@happier-dev/protocol/teams';
import type { HomeTargetInput } from '@happier-dev/cli-common/homeTarget';

import { resolveHomeAuthenticationTarget } from '@/auth/flows/resolveHomeAuthenticationTarget';
import { decodeBoundedJsonResponse } from '@/sync/api/capabilities/decodeBoundedJsonResponse';
import { createServerFetchAtEndpoint } from '@/sync/http/client';

/**
 * The bounded invitation preview for one exact bearer on one exact Home.
 *
 * Preview is the canonical owner of what a join screen may say about an offer —
 * role, history horizon, expiry, masked recipient, the Home's own name and its
 * storage disclosure — and it never consumes the invitation. The screen renders
 * this and nothing it inferred elsewhere: the authentication entry projection
 * deliberately carries only the Team lockup, so reading consequences off it
 * would be a second, weaker answer to a question this owner already answers.
 *
 * `unavailable` is the preview owner's intentionally coarse response for a
 * syntactically valid bearer it will not describe. It is not an error and not
 * proof the invitation never existed, so callers present it as "this link is not
 * usable" rather than inventing a terminal reason.
 */
export type TeamInvitationPreviewState =
    | Readonly<{ kind: 'idle' }>
    | Readonly<{ kind: 'loading' }>
    | Readonly<{ kind: 'ready'; preview: TeamInvitationPreviewV1 }>
    | Readonly<{ kind: 'unavailable' }>
    | Readonly<{ kind: 'update_required' }>
    | Readonly<{ kind: 'failed'; retryable: boolean }>;

const IDLE: TeamInvitationPreviewState = Object.freeze({ kind: 'idle' as const });

export function useTeamInvitationPreview(params: Readonly<{
    target: HomeTargetInput | null | undefined;
    token: string | null | undefined;
    /** Bumped by the surface's own retry so one control refreshes the whole page. */
    revision?: number;
}>): TeamInvitationPreviewState {
    const resolvedTarget = React.useMemo(
        () => params.target ? resolveHomeAuthenticationTarget(params.target) : null,
        [params.target],
    );
    const token = params.token ?? '';
    const revision = params.revision ?? 0;
    const [state, setState] = React.useState<TeamInvitationPreviewState>(IDLE);

    React.useEffect(() => {
        if (!resolvedTarget || !token) {
            setState(IDLE);
            return;
        }
        let current = true;
        setState({ kind: 'loading' });
        void (async () => {
            try {
                const request = createServerFetchAtEndpoint({
                    endpointUrl: resolvedTarget.endpointUrl,
                    serverId: resolvedTarget.serverId,
                    credentials: null,
                });
                // Method, path and body come from the preview Action row — the
                // single declaration of this intent's transport — exactly as the
                // authenticated family port binds its requests. The join screen is
                // pre-authentication, so it carries the bound request on the
                // credential-free exact-Home fetch instead of an Account scope.
                const boundRequest = bindHomeDomainActionHttpRequestV1('teams.invitations.preview', { v: 1, token });
                const response = await request(boundRequest.path, {
                    method: boundRequest.method,
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify(boundRequest.body),
                }, { includeAuth: false, retry: 'none' });
                if (!current) return;
                // Only a Home without this route at all — an older binary — may
                // claim update-required; a capable Home answers its own typed
                // `feature_unavailable` outcome below.
                if (response.status === 404 || response.status === 405 || response.status === 501) {
                    setState({ kind: 'update_required' });
                    return;
                }
                if (!response.ok) {
                    setState({ kind: 'failed', retryable: response.status >= 500 });
                    return;
                }
                const raw = await decodeBoundedJsonResponse(response, 64 * 1024);
                const outcome = TeamInvitationPreviewResultV1Schema.safeParse(raw);
                if (!outcome.success) {
                    setState({ kind: 'update_required' });
                    return;
                }
                if (outcome.data.outcome === 'ok') {
                    setState({ kind: 'ready', preview: outcome.data.preview });
                    return;
                }
                // `feature_unavailable` is a capable Home's operator choice, not an
                // old binary: child 05 §8 requires it to present as unavailable,
                // while the 404/405/501 branch above stays the update-required case.
                setState({ kind: 'unavailable' });
            } catch {
                // An approval-pending or transport throw is not a description of
                // the invitation; the surface keeps its own retry.
                if (current) setState({ kind: 'failed', retryable: true });
                return;
            }
        })();
        return () => { current = false; };
    }, [resolvedTarget, token, revision]);

    return state;
}
