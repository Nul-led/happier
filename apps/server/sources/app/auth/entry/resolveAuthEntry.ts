import {
    AUTH_ENTRY_RESPONSE_MAX_UTF8_BYTES_V1,
    AuthEntryProjectionV1Schema,
    type AuthEntryProjectionV1,
    type AuthEntryRequestV1,
    type TeamEntryUnavailableReasonV1,
} from '@happier-dev/protocol';
import { normalizeAuthMethodId, readServerEnabledBit } from '@happier-dev/protocol';
import type { AuthTokenAuthenticationEvidenceV1 } from '@happier-dev/protocol';

import {
    resolveEffectiveHomeAuthMethods,
    resolveEffectiveHomeAuthMethodsInTx,
    type EffectiveHomeAuthMethodsResult,
} from '@/app/auth/methods/effectiveHomeAuthMethods';
import { listProviderDescriptorsInTx } from '@/app/auth/providers/identityProviderCatalog';
import { resolveAuthFeature } from '@/app/features/authFeature';
import { resolveFeaturesFromEnv } from '@/app/features/registry';
import {
    resolveTeamInvitationAuthEntryContextInTx,
    resolveTeamInvitationAuthEntryReferenceContextInTx,
    type TeamInvitationAuthEntryContext,
} from '@/app/teams/invitations/invitationService';
import { resolveTeamAuthEntryContextInTx, type TeamAuthEntryContext } from '@/app/teams/authEntryContext';
import {
    qualifyTeamOperationAuthenticationInTx,
    resolveTeamActorContextInTx,
} from '@/app/teams/actorContext';
import { isEffectiveTeamMembership } from '@/app/teams/memberships/effectiveMembership';
import { listTeamIdentityConnectionsInTx } from '@/app/teams/identity/teamIdentityConnectionLifecycle';
import { inTx } from '@/storage/inTx';
import { isAuthEmailDeliveryReady } from '@/app/auth/email/resolveAuthEmailDelivery';
import {
    ACCOUNT_DISPLAY_PROFILE_SELECT,
    projectAccountDisplayProfileV1,
} from '@/app/account/profile/accountDisplayProfile';
import { resolveJoinScreenHomeIdentity } from '@/app/teams/invitations/joinScreenHome';
import type { JoinScreenHomeIdentity } from '@/app/teams/invitations/invitationService';
import { readNativeAuthOneTimeOperation } from '@/app/auth/email/nativeAuthOneTimeOperations';
import { shouldDenyPublicSignupProvisioningAction } from '@/app/integrations/publicUrl/publicSignupProvisioningPolicy';
import type { Tx } from '@/storage/inTx';

import {
    resolveTeamAuthenticationPolicyInTx,
    type ResolvedTeamAuthenticationPolicyInTx,
} from './resolveTeamAuthenticationPolicy';

/**
 * The verified caller, when the request carried an ordinary present-user Home
 * credential. It is supplied only by the route's canonical verification owner;
 * an absent, invalid, ineligible or restricted credential simply omits it and
 * the projection stays anonymous.
 */
export type AuthEntryPrincipal = Readonly<{
    accountId: string;
    authenticationEvidence?: readonly AuthTokenAuthenticationEvidenceV1[];
}>;

type ResolveAuthEntryContext = Readonly<{
    env: NodeJS.ProcessEnv;
    emailDeliveryReady?: boolean;
    principal?: AuthEntryPrincipal | null;
    /**
     * The requesting address as the route attributes it. The public-signup
     * provisioning restriction is decided per address, so a caller that cannot
     * attribute one publishes the unrestricted catalog, as every finalizer
     * still enforces the restriction on its own request.
     */
    requestIp?: unknown;
}>;

/** What the Home-method action projection needs to know about the request. */
type HomeActionRequestContext = Readonly<{
    env: NodeJS.ProcessEnv;
    principal: AuthEntryPrincipal | null;
    requestIp?: unknown;
}>;

/**
 * Why the three answers are distinct: only a member can be admitted by signing
 * in again, so a `member_unqualified` visitor is offered the Team's accepted
 * methods, while a `non_member` of a directory-provisioned Team cannot be
 * admitted by any sign-in this Home can offer.
 */
type TeamMembershipAdmissionState = 'admitted' | 'member_unqualified' | 'non_member';

async function resolveTeamMembershipAdmissionInTx(
    tx: Parameters<typeof resolveTeamActorContextInTx>[0],
    input: Readonly<{
        env: NodeJS.ProcessEnv;
        teamId: string;
        principal: AuthEntryPrincipal | null;
    }>,
): Promise<TeamMembershipAdmissionState> {
    if (input.principal === null) return 'non_member';
    const actor = await resolveTeamActorContextInTx(tx, {
        teamId: input.teamId,
        actorAccountId: input.principal.accountId,
    });
    if (!actor?.membership || !isEffectiveTeamMembership({
        accountStatus: actor.accountStatus,
        membershipStatus: actor.membership.status,
        teamArchivedAt: actor.team.archivedAt,
    })) return 'non_member';
    const qualification = await qualifyTeamOperationAuthenticationInTx(tx, {
        context: actor,
        env: input.env,
        authenticationEvidence: input.principal.authenticationEvidence,
        authenticationAuthority: 'present_user',
    });
    return qualification.ok ? 'admitted' : 'member_unqualified';
}

async function resolveAuthenticatedAccountPresentationInTx(
    tx: Parameters<typeof resolveTeamActorContextInTx>[0],
    principal: AuthEntryPrincipal | null,
) {
    if (principal === null) return null;
    const account = await tx.account.findUnique({
        where: { id: principal.accountId },
        select: ACCOUNT_DISPLAY_PROFILE_SELECT,
    });
    return account ? projectAccountDisplayProfileV1(account) : null;
}

const AUTH_ENTRY_UTF8_ENCODER = new TextEncoder();

export function projectUnavailableHomeAuthEntry(
    reason: 'not_account_service' | 'authentication_policy_unavailable',
): AuthEntryProjectionV1 {
    return AuthEntryProjectionV1Schema.parse({
        v: 1,
        state: 'unavailable',
        scope: { kind: 'home' },
        reason,
        autoRedirect: null,
    });
}

/**
 * Why a Team or invitation destination is unavailable, said only as far as the
 * request has earned. `entry_not_available` is the non-enumerating default and
 * is passed explicitly at every site that must stay opaque; a named reason is
 * only chosen where the request already proved it may see this destination, so
 * naming it discloses nothing the ordinary admission page would not.
 */
function unavailableInvitationProjection(reason: TeamEntryUnavailableReasonV1): AuthEntryProjectionV1 {
    return AuthEntryProjectionV1Schema.parse({
        v: 1,
        state: 'unavailable',
        scope: { kind: 'invitation' },
        reason,
        autoRedirect: null,
    });
}

function unavailableTeamProjection(reason: TeamEntryUnavailableReasonV1): AuthEntryProjectionV1 {
    return AuthEntryProjectionV1Schema.parse({
        v: 1,
        state: 'unavailable',
        scope: { kind: 'team' },
        reason,
        autoRedirect: null,
    });
}

/**
 * Whether the Team's current authentication policy offers any way in. A restricted
 * policy with no currently usable accepted reference is unavailable rather than an
 * admission page with no actions. A successful provider test (activation
 * readiness) is the policy writer's precondition, enforced at policy save; it is
 * not a member-entry gate, so an untested accepted choice still shows here.
 */
function hasUsableTeamAuthentication(policy: ResolvedTeamAuthenticationPolicyInTx): boolean {
    return policy.resolution.status === 'inherit'
        || (policy.resolution.status === 'restricted'
            && policy.resolution.choices.some((choice) => choice.availability === 'usable'));
}

/**
 * The reason a visitor who is already signed in to this Home may be told when a
 * Team refuses entry for its authentication policy alone.
 *
 * A `provisioned` Team takes its membership from a directory, so no sign-in this
 * visitor performs can admit them: `directory_delayed` is the truthful answer,
 * and telling them to use a different method would send them round a loop.
 * Otherwise a `restricted` policy with no currently usable choice is the Team
 * insisting on a sign-in this visitor cannot use — exactly what `sso_required`
 * says. An anonymous visitor has proved nothing, and an unresolved policy is not
 * a statement about the visitor at all, so both keep the opaque default.
 */
function teamEntryPolicyRefusalReason(
    policy: ResolvedTeamAuthenticationPolicyInTx,
    principal: AuthEntryPrincipal | null,
    admissionMode?: TeamAuthEntryContext['admissionMode'],
): TeamEntryUnavailableReasonV1 {
    if (principal === null) return 'entry_not_available';
    if (admissionMode === 'provisioned') return 'directory_delayed';
    return policy.resolution.status === 'restricted' ? 'sso_required' : 'entry_not_available';
}

function defaultMethodDisplayName(id: string): string {
    return id
        .split(/[_-]+/u)
        .filter(Boolean)
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(' ');
}

function projectHomeAuthenticationActions(
    homeMethods: Extract<EffectiveHomeAuthMethodsResult, { status: 'ready' }>,
    request: HomeActionRequestContext,
    allowedIds?: ReadonlySet<string>,
) {
    return homeMethods.decisions.flatMap((decision) => {
        const methodId = normalizeAuthMethodId(decision.id);
        if (!methodId || (allowedIds && !allowedIds.has(methodId))) return [];
        const displayName = decision.ui?.displayName ?? defaultMethodDisplayName(methodId);
        const iconHint = decision.ui?.iconHint ?? null;
        return decision.actions.flatMap((action) => {
            if (!action.enabled) return [];
            // `connect` attaches a method to the caller's existing Account; a
            // request without a principal has nothing to attach it to, and its
            // only completion lives in the signed-in Account Security flow.
            if (action.id === 'connect' && request.principal === null) return [];
            if (action.id === 'provision'
                && request.requestIp !== undefined
                && shouldDenyPublicSignupProvisioningAction({
                    env: request.env,
                    requestIp: request.requestIp,
                    methodId,
                    mode: action.mode,
                })) return [];
            return [{
                kind: 'authenticate' as const,
                methodId,
                action: action.id,
                mode: action.mode,
                origin: 'home' as const,
                presentation: {
                    displayName,
                    ...(iconHint ? { iconHint } : {}),
                },
            }];
        });
    });
}

function projectHomeAuthEntryProjection(
    homeMethods: Extract<EffectiveHomeAuthMethodsResult, { status: 'ready' }>,
    request: HomeActionRequestContext,
    allowAutoRedirect: boolean,
): AuthEntryProjectionV1 {
    const env = request.env;
    const actions = projectHomeAuthenticationActions(homeMethods, request);
    const compatibilityAutoRedirect = allowAutoRedirect
        ? resolveAuthFeature(env).capabilities?.auth?.ui?.autoRedirect
        : undefined;
    const autoRedirectMethodId = compatibilityAutoRedirect?.enabled === true
        ? normalizeAuthMethodId(String(compatibilityAutoRedirect.providerId ?? ''))
        : '';
    const autoRedirectAction = autoRedirectMethodId
        ? actions.find((action) => action.methodId === autoRedirectMethodId
            && action.action === 'provision'
            && (action.mode === 'keyed' || action.mode === 'either'))
            ?? actions.find((action) => action.methodId === autoRedirectMethodId
                && action.action === 'login'
                && (action.mode === 'keyless' || action.mode === 'either'))
            ?? actions.find((action) => action.methodId === autoRedirectMethodId
                && (action.action === 'login' || action.action === 'provision'))
        : undefined;
    const projection = {
        v: 1,
        state: 'ready',
        scope: { kind: 'home' },
        actions,
        ...(homeMethods.signInService ? { signInService: homeMethods.signInService } : {}),
        autoRedirect: autoRedirectAction
            ? {
                methodId: autoRedirectAction.methodId,
                action: autoRedirectAction.action,
                mode: autoRedirectAction.mode,
            }
            : null,
    } as const;
    if (AUTH_ENTRY_UTF8_ENCODER.encode(JSON.stringify(projection)).byteLength
        > AUTH_ENTRY_RESPONSE_MAX_UTF8_BYTES_V1) {
        return projectUnavailableHomeAuthEntry('authentication_policy_unavailable');
    }
    return AuthEntryProjectionV1Schema.parse(projection);
}

async function resolveTeamAuthEntry(
    teamId: string,
    request: HomeActionRequestContext & Readonly<{ emailDeliveryReady: boolean }>,
    home: JoinScreenHomeIdentity,
): Promise<AuthEntryProjectionV1> {
    const { env, principal, emailDeliveryReady } = request;
    return await inTx(async (tx) => {
        const teamContext = await resolveTeamAuthEntryContextInTx(tx, { teamId });
        if (teamContext === null) return unavailableTeamProjection('entry_not_available');
        const [policy, homeMethods] = await Promise.all([
            resolveTeamAuthenticationPolicyInTx(tx, {
                env,
                teamId,
                policy: teamContext.authenticationPolicy,
                emailDeliveryReady,
            }),
            resolveEffectiveHomeAuthMethodsInTx(tx, { env, emailDeliveryReady }),
        ]);
        if (!hasUsableTeamAuthentication(policy)) {
            return unavailableTeamProjection(
                teamEntryPolicyRefusalReason(policy, principal, teamContext.admissionMode),
            );
        }

        const account = await resolveAuthenticatedAccountPresentationInTx(tx, principal);

        // A caller who is already an effective member may continue when the current
        // credential proves the Team's accepted authentication context. Inherited
        // policy accepts any ordinary Home credential; restricted policy requires
        // one current evidence item matching a usable accepted reference.
        const admission = await resolveTeamMembershipAdmissionInTx(tx, {
            env,
            teamId,
            principal,
        });
        if (admission === 'admitted') {
            return AuthEntryProjectionV1Schema.parse({
                v: 1,
                state: 'already_member',
                scope: { kind: 'team' },
                home,
                account,
                team: teamContext.team,
                actions: [{ kind: 'continue' }],
                autoRedirect: null,
            });
        }
        // A `provisioned` Team's roster comes from its directory, so a signed-in
        // stranger cannot join by authenticating again however usable the Team's
        // policy is. Saying so is the truthful answer; offering sign-in actions
        // would send them round a loop. A member whose credential merely failed
        // to qualify keeps those actions, because signing in does admit them.
        if (admission === 'non_member' && principal !== null && teamContext.admissionMode === 'provisioned') {
            return unavailableTeamProjection('directory_delayed');
        }
        if (homeMethods.status !== 'ready') return unavailableTeamProjection('entry_not_available');

        const allowedHomeMethodIds = policy.resolution.status === 'restricted'
            ? new Set(policy.resolution.choices.flatMap((choice) =>
                choice.availability === 'usable' && choice.reference.kind === 'home_method'
                    ? [normalizeAuthMethodId(choice.reference.methodId)]
                    : []))
            : undefined;
        const allowedConnectionIds = policy.resolution.status === 'restricted'
            ? new Set(policy.resolution.choices.flatMap((choice) =>
                choice.availability === 'usable' && choice.reference.kind === 'team_connection'
                    ? [choice.reference.connectionId]
                    : []))
            : undefined;
        const homeActions = projectHomeAuthenticationActions(homeMethods, request, allowedHomeMethodIds);
        const [connections, descriptors] = await Promise.all([
            listTeamIdentityConnectionsInTx(tx, { teamId }),
            listProviderDescriptorsInTx(tx, env, { kind: 'team', teamId }),
        ]);
        const descriptorByProviderId = new Map(descriptors.map((descriptor) => [
            normalizeAuthMethodId(descriptor.reference.id),
            descriptor,
        ]));
        const teamActions = connections.flatMap((connection) => {
            if (
                connection.state !== 'connected'
                || (allowedConnectionIds && !allowedConnectionIds.has(connection.id))
            ) return [];
            const provider = descriptorByProviderId.get(normalizeAuthMethodId(connection.providerInstanceId));
            if (!provider || provider.descriptor.enabled !== true || provider.descriptor.configured !== true) return [];
            const displayName = provider.descriptor.ui?.displayName ?? connection.providerDisplayName;
            const iconHint = provider.descriptor.ui?.iconHint ?? null;
            return [{
                kind: 'authenticate' as const,
                methodId: provider.reference.id,
                action: 'connect' as const,
                mode: 'either' as const,
                origin: 'team' as const,
                presentation: {
                    displayName,
                    ...(iconHint ? { iconHint } : {}),
                },
            }];
        });
        const projection = {
            v: 1,
            state: 'admission_required',
            scope: { kind: 'team' },
            home,
            ...(account ? { account } : {}),
            team: teamContext.team,
            // A visitor who already proved an Account and is still not admitted
            // is signed in as the wrong one. Offering another Account is the
            // only remedy the Home can name, and it discloses nothing: the
            // caller already knows which Account they presented. An anonymous
            // visitor gets no such offer, so this cannot become an oracle.
            actions: [
                ...teamActions,
                ...homeActions,
                ...(principal !== null ? [{ kind: 'switch_account' as const }] : []),
            ],
            ...(homeMethods.signInService ? { signInService: homeMethods.signInService } : {}),
            autoRedirect: null,
        } as const;
        if (AUTH_ENTRY_UTF8_ENCODER.encode(JSON.stringify(projection)).byteLength
            > AUTH_ENTRY_RESPONSE_MAX_UTF8_BYTES_V1) return unavailableTeamProjection('entry_not_available');
        return AuthEntryProjectionV1Schema.parse(projection);
    });
}

async function resolveInvitationAuthEntryInTx(
    tx: Tx,
    invitation: TeamInvitationAuthEntryContext,
    env: NodeJS.ProcessEnv,
    emailDeliveryReady: boolean,
    principal: AuthEntryPrincipal | null,
    home: JoinScreenHomeIdentity,
): Promise<AuthEntryProjectionV1> {
    const admission = { kind: 'team_invitation' as const };
    const [policy, homeMethods] = await Promise.all([
        resolveTeamAuthenticationPolicyInTx(tx, {
            env,
            teamId: invitation.team.teamId,
            policy: invitation.authenticationPolicy,
            admission,
            emailDeliveryReady,
        }),
        resolveEffectiveHomeAuthMethodsInTx(tx, {
            env,
            emailDeliveryReady,
            admission,
        }),
    ]);
    if (!hasUsableTeamAuthentication(policy)) {
        return unavailableInvitationProjection(teamEntryPolicyRefusalReason(policy, principal));
    }

    const account = await resolveAuthenticatedAccountPresentationInTx(tx, principal);

    if (await resolveTeamMembershipAdmissionInTx(tx, {
        env,
        teamId: invitation.team.teamId,
        principal,
    }) === 'admitted') {
        return AuthEntryProjectionV1Schema.parse({
            v: 1,
            state: 'already_member',
            scope: { kind: 'invitation' },
            home,
            account,
            team: invitation.team,
            actions: [{ kind: 'continue' }],
            autoRedirect: null,
        });
    }
    if (homeMethods.status !== 'ready') return unavailableInvitationProjection('entry_not_available');

    const currentAccountRecipientStatus = principal && invitation.recipientEmailNormalized
        ? await tx.accountEmail.findUnique({
            where: {
                accountId_normalizedEmail: {
                    accountId: principal.accountId,
                    normalizedEmail: invitation.recipientEmailNormalized,
                },
            },
            select: { accountId: true },
        }).then((mailbox) => mailbox ? 'already_verified' as const : 'verification_required' as const)
        : undefined;

    const allowedHomeMethodIds = policy.resolution.status === 'restricted'
        ? new Set(policy.resolution.choices.flatMap((choice) =>
            choice.availability === 'usable' && choice.reference.kind === 'home_method'
                ? [normalizeAuthMethodId(choice.reference.methodId)]
                : []))
        : undefined;
    const allowedConnectionIds = policy.resolution.status === 'restricted'
        ? new Set(policy.resolution.choices.flatMap((choice) =>
            choice.availability === 'usable' && choice.reference.kind === 'team_connection'
                ? [choice.reference.connectionId]
                : []))
        : undefined;
    // Invitation admission is exempt from the public-signup restriction in every
    // finalizer, so the invitation projection carries no requesting address.
    const homeActions = projectHomeAuthenticationActions(homeMethods, { env, principal }, allowedHomeMethodIds);
    const [connections, descriptors] = await Promise.all([
        listTeamIdentityConnectionsInTx(tx, { teamId: invitation.team.teamId }),
        listProviderDescriptorsInTx(tx, env, { kind: 'team', teamId: invitation.team.teamId }),
    ]);
    const descriptorByProviderId = new Map(descriptors.map((descriptor) => [
        normalizeAuthMethodId(descriptor.reference.id),
        descriptor,
    ]));
    const connectionActions = connections.flatMap((connection) => {
        if (connection.state !== 'connected'
            || (allowedConnectionIds && !allowedConnectionIds.has(connection.id))) return [];
        const provider = descriptorByProviderId.get(normalizeAuthMethodId(connection.providerInstanceId));
        if (!provider || provider.descriptor.enabled !== true || provider.descriptor.configured !== true) return [];
        const iconHint = provider.descriptor.ui?.iconHint ?? null;
        return [{
            kind: 'authenticate' as const,
            methodId: provider.reference.id,
            action: 'connect' as const,
            mode: 'either' as const,
            origin: 'team' as const,
            presentation: {
                displayName: provider.descriptor.ui?.displayName ?? connection.providerDisplayName,
                ...(iconHint ? { iconHint } : {}),
            },
        }];
    });
    const projection = {
        v: 1,
        state: 'admission_required',
        scope: { kind: 'invitation' },
        home,
        ...(account ? { account } : {}),
        team: invitation.team,
        invitationEmailVerificationRequired: invitation.recipientEmailNormalized === null,
        actions: [
            ...connectionActions,
            ...homeActions,
            ...(currentAccountRecipientStatus === 'verification_required'
                ? [{ kind: 'switch_account' as const }]
                : []),
        ],
        ...(currentAccountRecipientStatus ? { currentAccountRecipientStatus } : {}),
        ...(homeMethods.signInService ? { signInService: homeMethods.signInService } : {}),
        autoRedirect: null,
    } as const;
    if (AUTH_ENTRY_UTF8_ENCODER.encode(JSON.stringify(projection)).byteLength
        > AUTH_ENTRY_RESPONSE_MAX_UTF8_BYTES_V1) return unavailableInvitationProjection('entry_not_available');
    return AuthEntryProjectionV1Schema.parse(projection);
}

async function resolveInvitationAuthEntry(
    token: string,
    env: NodeJS.ProcessEnv,
    emailDeliveryReady: boolean,
    principal: AuthEntryPrincipal | null,
    home: JoinScreenHomeIdentity,
): Promise<AuthEntryProjectionV1> {
    return await inTx(async (tx) => {
        const invitation = await resolveTeamInvitationAuthEntryContextInTx(tx, { token });
        // The bearer is the proof of visibility here: naming a spent, revoked or
        // unknown invitation tells a holder what to do next and names no Team.
        return invitation
            ? await resolveInvitationAuthEntryInTx(tx, invitation, env, emailDeliveryReady, principal, home)
            : unavailableInvitationProjection('invitation_unavailable');
    });
}

/**
 * The public auth-entry projection is deliberately stateless. Every executable start route
 * resolves its method/provider again; this response grants no provider or admission authority.
 */
export async function resolveAuthEntry(
    input: AuthEntryRequestV1,
    context: ResolveAuthEntryContext = { env: process.env },
): Promise<AuthEntryProjectionV1> {
    // Reuse the Home feature-composition owner for the service policy/capability relationship.
    // The auth-entry method rows below remain live catalog projections rather than feature rows.
    const homeFeatures = resolveFeaturesFromEnv(context.env);
    if (input.scope.kind === 'team') {
        if (readServerEnabledBit(homeFeatures, 'teams') !== true) return unavailableTeamProjection('entry_not_available');
        const home = await resolveJoinScreenHomeIdentity(context.env);
        return await resolveTeamAuthEntry(input.scope.teamId, {
            env: context.env,
            principal: context.principal ?? null,
            emailDeliveryReady: context.emailDeliveryReady ?? isAuthEmailDeliveryReady(context.env),
            ...(context.requestIp === undefined ? {} : { requestIp: context.requestIp }),
        }, home);
    }
    if (input.scope.kind === 'home' && input.purpose === 'account_service'
        && homeFeatures.capabilities.accountDirectory?.homeDirectory !== true) {
        return projectUnavailableHomeAuthEntry('not_account_service');
    }
    if (input.scope.kind === 'invitation') {
        if (readServerEnabledBit(homeFeatures, 'teams') !== true) {
            return unavailableInvitationProjection('entry_not_available');
        }
        const home = await resolveJoinScreenHomeIdentity(context.env);
        return await resolveInvitationAuthEntry(
            input.scope.token,
            context.env,
            context.emailDeliveryReady ?? isAuthEmailDeliveryReady(context.env),
            context.principal ?? null,
            home,
        );
    }
    if (input.scope.kind === 'native_email_verification') {
        const verificationToken = input.scope.token;
        const home = await resolveJoinScreenHomeIdentity(context.env);
        return await inTx(async (tx) => {
            const operation = await readNativeAuthOneTimeOperation(tx, {
                purpose: 'verify_native_email',
                token: verificationToken,
            });
            if (operation?.purpose !== 'verify_native_email') return unavailableInvitationProjection('entry_not_available');
            if (operation.consumer.kind === 'team_invitation') {
                if (readServerEnabledBit(homeFeatures, 'teams') !== true) return unavailableInvitationProjection('entry_not_available');
                const invitation = await resolveTeamInvitationAuthEntryReferenceContextInTx(tx, operation.consumer);
                return invitation
                    ? await resolveInvitationAuthEntryInTx(
                        tx,
                        invitation,
                        context.env,
                        context.emailDeliveryReady ?? isAuthEmailDeliveryReady(context.env),
                        context.principal ?? null,
                        home,
                    )
                    : unavailableInvitationProjection('invitation_unavailable');
            }
            if (operation.consumer.kind !== 'fresh_account') return unavailableInvitationProjection('entry_not_available');
            const homeMethods = await resolveEffectiveHomeAuthMethodsInTx(tx, {
                env: context.env,
                emailDeliveryReady: context.emailDeliveryReady ?? isAuthEmailDeliveryReady(context.env),
            });
            if (homeMethods.status !== 'ready') return projectUnavailableHomeAuthEntry('authentication_policy_unavailable');
            return projectHomeAuthEntryProjection(homeMethods, {
                env: context.env,
                principal: context.principal ?? null,
                ...(context.requestIp === undefined ? {} : { requestIp: context.requestIp }),
            }, false);
        });
    }
    const homeMethods = await resolveEffectiveHomeAuthMethods({
        env: context.env,
        emailDeliveryReady: context.emailDeliveryReady ?? isAuthEmailDeliveryReady(context.env),
    });
    if (homeMethods.status !== 'ready') {
        return projectUnavailableHomeAuthEntry('authentication_policy_unavailable');
    }
    return projectHomeAuthEntryProjection(homeMethods, {
        env: context.env,
        principal: context.principal ?? null,
        ...(context.requestIp === undefined ? {} : { requestIp: context.requestIp }),
    }, true);
}
