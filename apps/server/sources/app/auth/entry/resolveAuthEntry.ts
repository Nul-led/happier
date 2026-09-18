import {
    AUTH_ENTRY_RESPONSE_MAX_UTF8_BYTES_V1,
    AuthEntryProjectionV1Schema,
    type AuthEntryProjectionV1,
    type AuthEntryRequestV1,
} from '@happier-dev/protocol';
import { readServerEnabledBit } from '@happier-dev/protocol';
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
import { resolveTeamAuthEntryContextInTx } from '@/app/teams/authEntryContext';
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

async function isAdmittedTeamMemberInTx(
    tx: Parameters<typeof resolveTeamActorContextInTx>[0],
    input: Readonly<{
        env: NodeJS.ProcessEnv;
        teamId: string;
        principal: AuthEntryPrincipal | null;
    }>,
): Promise<boolean> {
    if (input.principal === null) return false;
    const actor = await resolveTeamActorContextInTx(tx, {
        teamId: input.teamId,
        actorAccountId: input.principal.accountId,
    });
    if (!actor?.membership || !isEffectiveTeamMembership({
        accountStatus: actor.accountStatus,
        membershipStatus: actor.membership.status,
        teamArchivedAt: actor.team.archivedAt,
    })) return false;
    const qualification = await qualifyTeamOperationAuthenticationInTx(tx, {
        context: actor,
        env: input.env,
        authenticationEvidence: input.principal.authenticationEvidence,
        authenticationAuthority: 'present_user',
    });
    return qualification.ok;
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

function unavailableProjection(reason: 'not_account_service' | 'authentication_policy_unavailable'): AuthEntryProjectionV1 {
    return AuthEntryProjectionV1Schema.parse({
        v: 1,
        state: 'unavailable',
        scope: { kind: 'home' },
        reason,
        autoRedirect: null,
    });
}

function unavailableInvitationProjection(): AuthEntryProjectionV1 {
    return AuthEntryProjectionV1Schema.parse({
        v: 1,
        state: 'unavailable',
        scope: { kind: 'invitation' },
        reason: 'entry_not_available',
        autoRedirect: null,
    });
}

function unavailableTeamProjection(): AuthEntryProjectionV1 {
    return AuthEntryProjectionV1Schema.parse({
        v: 1,
        state: 'unavailable',
        scope: { kind: 'team' },
        reason: 'entry_not_available',
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
        const methodId = decision.id.trim().toLowerCase();
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
        ? String(compatibilityAutoRedirect.providerId ?? '').trim().toLowerCase()
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
        return unavailableProjection('authentication_policy_unavailable');
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
        if (teamContext === null) return unavailableTeamProjection();
        const [policy, homeMethods] = await Promise.all([
            resolveTeamAuthenticationPolicyInTx(tx, {
                env,
                teamId,
                policy: teamContext.authenticationPolicy,
                emailDeliveryReady,
            }),
            resolveEffectiveHomeAuthMethodsInTx(tx, { env, emailDeliveryReady }),
        ]);
        if (!hasUsableTeamAuthentication(policy)) return unavailableTeamProjection();

        const account = await resolveAuthenticatedAccountPresentationInTx(tx, principal);

        // A caller who is already an effective member may continue when the current
        // credential proves the Team's accepted authentication context. Inherited
        // policy accepts any ordinary Home credential; restricted policy requires
        // one current evidence item matching a usable accepted reference.
        if (await isAdmittedTeamMemberInTx(tx, {
            env,
            teamId,
            principal,
        })) {
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
        if (homeMethods.status !== 'ready') return unavailableTeamProjection();

        const allowedHomeMethodIds = policy.resolution.status === 'restricted'
            ? new Set(policy.resolution.choices.flatMap((choice) =>
                choice.availability === 'usable' && choice.reference.kind === 'home_method'
                    ? [choice.reference.methodId.trim().toLowerCase()]
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
            descriptor.reference.id.trim().toLowerCase(),
            descriptor,
        ]));
        const teamActions = connections.flatMap((connection) => {
            if (
                connection.state !== 'connected'
                || (allowedConnectionIds && !allowedConnectionIds.has(connection.id))
            ) return [];
            const provider = descriptorByProviderId.get(connection.providerInstanceId.trim().toLowerCase());
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
            actions: [...teamActions, ...homeActions],
            ...(homeMethods.signInService ? { signInService: homeMethods.signInService } : {}),
            autoRedirect: null,
        } as const;
        if (AUTH_ENTRY_UTF8_ENCODER.encode(JSON.stringify(projection)).byteLength
            > AUTH_ENTRY_RESPONSE_MAX_UTF8_BYTES_V1) return unavailableTeamProjection();
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
    if (!hasUsableTeamAuthentication(policy)) return unavailableInvitationProjection();

    const account = await resolveAuthenticatedAccountPresentationInTx(tx, principal);

    if (await isAdmittedTeamMemberInTx(tx, {
        env,
        teamId: invitation.team.teamId,
        principal,
    })) {
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
    if (homeMethods.status !== 'ready') return unavailableInvitationProjection();

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
                ? [choice.reference.methodId.trim().toLowerCase()]
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
        descriptor.reference.id.trim().toLowerCase(),
        descriptor,
    ]));
    const connectionActions = connections.flatMap((connection) => {
        if (connection.state !== 'connected'
            || (allowedConnectionIds && !allowedConnectionIds.has(connection.id))) return [];
        const provider = descriptorByProviderId.get(connection.providerInstanceId.trim().toLowerCase());
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
        > AUTH_ENTRY_RESPONSE_MAX_UTF8_BYTES_V1) return unavailableInvitationProjection();
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
        return invitation
            ? await resolveInvitationAuthEntryInTx(tx, invitation, env, emailDeliveryReady, principal, home)
            : unavailableInvitationProjection();
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
        if (readServerEnabledBit(homeFeatures, 'teams') !== true) return unavailableTeamProjection();
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
        return unavailableProjection('not_account_service');
    }
    if (input.scope.kind === 'invitation') {
        if (readServerEnabledBit(homeFeatures, 'teams') !== true) {
            return unavailableInvitationProjection();
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
            if (operation?.purpose !== 'verify_native_email') return unavailableInvitationProjection();
            if (operation.consumer.kind === 'team_invitation') {
                if (readServerEnabledBit(homeFeatures, 'teams') !== true) return unavailableInvitationProjection();
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
                    : unavailableInvitationProjection();
            }
            if (operation.consumer.kind !== 'fresh_account') return unavailableInvitationProjection();
            const homeMethods = await resolveEffectiveHomeAuthMethodsInTx(tx, {
                env: context.env,
                emailDeliveryReady: context.emailDeliveryReady ?? isAuthEmailDeliveryReady(context.env),
            });
            if (homeMethods.status !== 'ready') return unavailableProjection('authentication_policy_unavailable');
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
        return unavailableProjection('authentication_policy_unavailable');
    }
    return projectHomeAuthEntryProjection(homeMethods, {
        env: context.env,
        principal: context.principal ?? null,
        ...(context.requestIp === undefined ? {} : { requestIp: context.requestIp }),
    }, true);
}
