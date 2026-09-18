import { FEATURES_RESPONSE_MAX_UTF8_BYTES_V1 } from '@happier-dev/protocol';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { Prisma } from '@prisma/client';

import { db } from '@/storage/db';
import { createLightSqliteHarness, type LightSqliteHarness } from '@/testkit/lightSqliteHarness';
import { inTx } from '@/storage/inTx';
import { createTeamInvitationInTx } from '@/app/teams/invitations/invitationLifecycle';
import { digestTeamInvitationToken } from '@/app/teams/invitations/token';
import {
    consumeNativeAuthOneTimeOperationInTx,
    issueNativeAuthOneTimeOperationInTx,
    readNativeAuthOneTimeOperation,
} from '@/app/auth/email/nativeAuthOneTimeOperations';
import { hashPasswordMaterial } from '@/app/auth/password/passwordMaterialVerifier';

import { resolveAuthEntry } from './resolveAuthEntry';

const INVITATION_TOKEN = 'a'.repeat(43);
const MANAGED_OIDC_CONFIG = {
    v: 1,
    kind: 'oidc',
    issuer: 'https://id.example.test',
    clientId: 'happier',
    clientAuthenticationMethod: "client_secret_post",
    scopes: 'openid profile email',
    httpTimeoutSeconds: 30,
    claims: { login: 'preferred_username', email: 'email', groups: 'groups' },
    allow: { usersAllowlist: [], emailDomains: [], groupsAny: [], groupsAll: [] },
    fetchUserInfo: true,
    storeRefreshToken: false,
    ui: { buttonColor: null, iconHint: 'oidc' },
} as const;

function oidcEntry(id: string): Record<string, unknown> {
    return {
        id,
        type: 'oidc',
        displayName: 'Acme identity',
        issuer: 'https://issuer.example.test',
        clientId: 'client-id-is-private',
        clientAuthenticationMethod: "client_secret_post",
        clientSecret: 'client-secret-is-private',
        redirectUrl: `https://home.example.test/v1/oauth/${id}/callback`,
    };
}

describe('resolveAuthEntry', () => {
    let harness: LightSqliteHarness;

    beforeAll(async () => {
        harness = await createLightSqliteHarness({
            tempDirPrefix: 'happier-auth-entry-',
            initAuth: false,
            initEncrypt: true,
            initFiles: false,
        });
    }, 180_000);

    afterEach(async () => {
        await db.teamIdentityConnection.deleteMany({});
        await db.identityProviderInstance.deleteMany({});
        await db.teamMembership.deleteMany({});
        await db.team.deleteMany({});
        await db.account.deleteMany({});
        await db.homeGovernancePolicy.deleteMany({});
        await db.repeatKey.deleteMany({});
    });

    async function member(
        teamId: string,
        overrides: Readonly<{
            status?: 'active' | 'suspended';
            accountStatus?: 'active' | 'disabled';
            firstName?: string;
            username?: string;
        }> = {},
    ) {
        const account = await db.account.create({
            data: {
                publicKey: crypto.randomUUID(),
                encryptionMode: 'plain',
                ...(overrides.firstName ? { firstName: overrides.firstName } : {}),
                ...(overrides.username ? { username: overrides.username } : {}),
                ...(overrides.accountStatus ? { status: overrides.accountStatus } : {}),
            },
        });
        await db.teamMembership.create({
            data: {
                teamId,
                accountId: account.id,
                role: 'member',
                ...(overrides.status ? { status: overrides.status } : {}),
            },
        });
        return account;
    }

    async function activeInvitation(authenticationPolicy?: Prisma.InputJsonValue) {
        const team = await db.team.create({ data: {
            name: 'Acme', ...(authenticationPolicy === undefined ? {} : { authenticationPolicy }),
        } });
        await inTx((tx) => createTeamInvitationInTx(tx, {
            teamId: team.id, role: 'member', historyAccess: 'from_membership',
            createdByAccountId: null, recipientEmailNormalized: 'invited@example.test',
            tokenHash: digestTeamInvitationToken(INVITATION_TOKEN), now: new Date(),
        }));
        return team;
    }

    it('projects an immutable Team target from current Team and Home policy in one server owner', async () => {
        const team = await db.team.create({
            data: {
                name: 'Acme Team',
                authenticationPolicy: {
                    v: 1,
                    mode: 'restricted',
                    accepted: [{ kind: 'home_method', methodId: 'email_password' }],
                },
            },
        });

        const projection = await resolveAuthEntry(
            { v: 1, scope: { kind: 'team', teamId: team.id } },
            {
                env: {
                    HAPPIER_FEATURE_TEAMS__ENABLED: '1',
                    HAPPIER_FEATURE_AUTH_EMAIL_PASSWORD__ENABLED: '1',
                },
            },
        );

        expect(projection).toMatchObject({
            v: 1,
            state: 'admission_required',
            scope: { kind: 'team' },
            team: { teamId: team.id, name: 'Acme Team', logo: null },
            autoRedirect: null,
        });
        if (projection.state !== 'admission_required') throw new Error('expected Team admission');
        expect(projection.actions).toEqual(expect.arrayContaining([
            expect.objectContaining({
                kind: 'authenticate',
                methodId: 'email_password',
                origin: 'home',
            }),
        ]));
    });

    it('keeps unknown and archived Team targets non-enumerating', async () => {
        const archived = await db.team.create({
            data: { name: 'Do not disclose', archivedAt: new Date('2026-09-06T00:00:00.000Z') },
        });
        const unavailable = (teamId: string) => resolveAuthEntry(
            { v: 1, scope: { kind: 'team', teamId } },
            { env: { HAPPIER_FEATURE_TEAMS__ENABLED: '1' } },
        );
        const expected = {
            v: 1,
            state: 'unavailable',
            scope: { kind: 'team' },
            reason: 'entry_not_available',
            autoRedirect: null,
        } as const;

        await expect(unavailable('missing-team')).resolves.toEqual(expected);
        await expect(unavailable(archived.id)).resolves.toEqual(expected);
    });

    it('projects a current Team-bound provider from the canonical Team catalog', async () => {
        await db.homeGovernancePolicy.create({
            data: {
                id: 'home',
                teamProviderPolicy: {
                    v: 1,
                    allowedTeamProviderKinds: ['oidc'],
                    teamJitAllowed: false,
                    approvedGitHubEnterpriseOrigins: [],
                },
            },
        });
        const team = await db.team.create({ data: { name: 'Provider Team' } });
        const provider = await db.identityProviderInstance.create({
            data: {
                ownerTeamId: team.id,
                kind: 'oidc',
                displayName: 'Provider Team SSO',
                enabled: true,
                firstEnabledAt: new Date('2026-09-06T00:00:00.000Z'),
                config: MANAGED_OIDC_CONFIG,
            },
        });
        await db.teamIdentityConnection.create({
            data: {
                teamId: team.id,
                providerInstanceId: provider.id,
                externalReference: { v: 1, kind: 'oidc' },
                settings: {
                    v: 1,
                    kind: 'oidc',
                    allowedUsers: [],
                    allowedEmailDomains: [],
                    groupsAny: [],
                    groupsAll: [],
                },
                enabled: true,
                firstEnabledAt: new Date('2026-09-06T00:00:00.000Z'),
            },
        });

        const projection = await resolveAuthEntry(
            { v: 1, scope: { kind: 'team', teamId: team.id } },
            {
                env: {
                    HAPPIER_FEATURE_TEAMS__ENABLED: '1',
                    HAPPIER_PUBLIC_SERVER_URL: 'https://home.example.test',
                },
            },
        );

        expect(projection.state).toBe('admission_required');
        expect(projection).not.toHaveProperty('account');
        if (projection.state !== 'admission_required') throw new Error('expected Team admission');
        expect(projection.actions).toEqual(expect.arrayContaining([
            expect.objectContaining({
                kind: 'authenticate',
                methodId: provider.id,
                action: 'connect',
                origin: 'team',
                presentation: expect.objectContaining({ displayName: 'Provider Team SSO' }),
            }),
        ]));
    });

    it('never reveals membership to an anonymous Team entry request', async () => {
        const team = await db.team.create({ data: { name: 'Acme Team' } });
        await member(team.id);

        const projection = await resolveAuthEntry(
            { v: 1, scope: { kind: 'team', teamId: team.id } },
            {
                env: {
                    HAPPIER_FEATURE_TEAMS__ENABLED: '1',
                    HAPPIER_FEATURE_AUTH_EMAIL_PASSWORD__ENABLED: '1',
                },
            },
        );

        expect(projection.state).toBe('admission_required');
        expect(projection).not.toHaveProperty('account');
    });

    it('continues an effective member of an inherited-policy Team without another login', async () => {
        const team = await db.team.create({ data: { name: 'Acme Team' } });
        const account = await member(team.id, { firstName: 'Alice', username: 'alice' });

        const projection = await resolveAuthEntry(
            { v: 1, scope: { kind: 'team', teamId: team.id } },
            {
                env: {
                    HAPPIER_FEATURE_TEAMS__ENABLED: '1',
                    HAPPIER_FEATURE_AUTH_EMAIL_PASSWORD__ENABLED: '1',
                    HAPPIER_PUBLIC_SERVER_URL: 'https://home.example.test',
                },
                principal: { accountId: account.id },
            },
        );

        expect(projection).toEqual({
            v: 1,
            state: 'already_member',
            scope: { kind: 'team' },
            home: { serverId: expect.any(String), displayName: 'home.example.test', storageMode: 'encrypted' },
            account: { firstName: 'Alice', lastName: null, username: 'alice', avatarUrl: null },
            team: { teamId: team.id, name: 'Acme Team', logo: null },
            actions: [{ kind: 'continue' }],
            autoRedirect: null,
        });
    });

    it('projects the exact authenticated Account on admission and changes it when the credential changes', async () => {
        const team = await db.team.create({ data: { name: 'Acme Team' } });
        const alice = await db.account.create({ data: {
            publicKey: crypto.randomUUID(), encryptionMode: 'plain', firstName: 'Alice', username: 'alice',
        } });
        const bob = await db.account.create({ data: {
            publicKey: crypto.randomUUID(), encryptionMode: 'plain', firstName: 'Bob', username: 'bob',
        } });
        const env = {
            HAPPIER_FEATURE_TEAMS__ENABLED: '1',
            HAPPIER_FEATURE_AUTH_EMAIL_PASSWORD__ENABLED: '1',
            HAPPIER_PUBLIC_SERVER_URL: 'https://home.example.test',
        };

        const entryFor = (accountId: string) => resolveAuthEntry(
            { v: 1, scope: { kind: 'team', teamId: team.id } },
            { env, principal: { accountId } },
        );

        await expect(entryFor(alice.id)).resolves.toMatchObject({
            state: 'admission_required',
            home: { displayName: 'home.example.test' },
            account: { firstName: 'Alice', username: 'alice' },
        });
        await expect(entryFor(bob.id)).resolves.toMatchObject({
            state: 'admission_required',
            home: { displayName: 'home.example.test' },
            account: { firstName: 'Bob', username: 'bob' },
        });
        await expect(resolveAuthEntry(
            { v: 1, scope: { kind: 'team', teamId: team.id } },
            { env },
        )).resolves.not.toHaveProperty('account');
    });

    it('keeps every non-effective authenticated caller on ordinary admission', async () => {
        const team = await db.team.create({ data: { name: 'Acme Team' } });
        const otherTeam = await db.team.create({ data: { name: 'Other Team' } });
        const nonMember = await db.account.create({
            data: { publicKey: crypto.randomUUID(), encryptionMode: 'plain' },
        });
        const suspended = await member(team.id, { status: 'suspended' });
        const disabled = await member(team.id, { accountStatus: 'disabled' });
        const otherTeamMember = await member(otherTeam.id);

        const entryFor = async (accountId: string) => await resolveAuthEntry(
            { v: 1, scope: { kind: 'team', teamId: team.id } },
            {
                env: {
                    HAPPIER_FEATURE_TEAMS__ENABLED: '1',
                    HAPPIER_FEATURE_AUTH_EMAIL_PASSWORD__ENABLED: '1',
                },
                principal: { accountId },
            },
        );

        for (const accountId of [nonMember.id, suspended.id, disabled.id, otherTeamMember.id]) {
            await expect(entryFor(accountId).then((projection) => projection.state))
                .resolves.toBe('admission_required');
        }
    });

    it('holds a restricted-policy Team closed for a member until credential evidence exists', async () => {
        const team = await db.team.create({
            data: {
                name: 'Restricted Team',
                authenticationPolicy: {
                    v: 1,
                    mode: 'restricted',
                    accepted: [{ kind: 'home_method', methodId: 'email_password' }],
                },
            },
        });
        const account = await member(team.id);

        const projection = await resolveAuthEntry(
            { v: 1, scope: { kind: 'team', teamId: team.id } },
            {
                env: {
                    HAPPIER_FEATURE_TEAMS__ENABLED: '1',
                    HAPPIER_FEATURE_AUTH_EMAIL_PASSWORD__ENABLED: '1',
                },
                principal: { accountId: account.id },
            },
        );

        // The Team is reachable and its accepted method is usable, so this is a
        // policy decision rather than an unavailable Team: membership alone must
        // not continue while nothing can prove how this credential authenticated.
        expect(projection.state).toBe('admission_required');
        if (projection.state !== 'admission_required') throw new Error('expected Team admission');
        expect(projection.actions).toEqual(expect.arrayContaining([
            expect.objectContaining({ methodId: 'email_password', origin: 'home' }),
        ]));
    });

    it('continues a restricted-policy member only while the exact Account owns the evidenced Home factor', async () => {
        const team = await db.team.create({
            data: {
                name: 'Restricted Evidence Team',
                authenticationPolicy: {
                    v: 1,
                    mode: 'restricted',
                    accepted: [{ kind: 'home_method', methodId: 'email_password' }],
                },
            },
        });
        const account = await member(team.id);
        const otherAccount = await db.account.create({
            data: { publicKey: null, encryptionMode: 'plain' },
        });
        await db.accountIdentity.create({
            data: {
                accountId: otherAccount.id,
                provider: 'email',
                providerUserId: 'other-factor@example.test',
                profile: {},
            },
        });
        await db.accountPasswordCredential.create({
            data: {
                accountId: otherAccount.id,
                credential: {
                    v: 1,
                    kind: 'plain_password_hash',
                    hash: await hashPasswordMaterial(new TextEncoder().encode('other Account password factor')),
                },
            },
        });

        const context = {
            env: {
                HAPPIER_FEATURE_TEAMS__ENABLED: '1',
                HAPPIER_FEATURE_AUTH_EMAIL_PASSWORD__ENABLED: '1',
                HAPPIER_FEATURE_E2EE__KEYLESS_ACCOUNTS_ENABLED: '1',
                HAPPIER_FEATURE_ENCRYPTION__STORAGE_POLICY: 'optional',
            },
            principal: {
                accountId: account.id,
                authenticationEvidence: [{ kind: 'home_method' as const, methodId: 'email_password' }],
            },
        };

        // A viable password factor on another Account cannot make this
        // credential's claimed method current.
        await expect(resolveAuthEntry(
            { v: 1, scope: { kind: 'team', teamId: team.id } },
            context,
        )).resolves.toMatchObject({ state: 'admission_required' });

        await db.accountIdentity.create({
            data: {
                accountId: account.id,
                provider: 'email',
                providerUserId: 'member-factor@example.test',
                profile: {},
            },
        });
        await db.accountPasswordCredential.create({
            data: {
                accountId: account.id,
                credential: {
                    v: 1,
                    kind: 'plain_password_hash',
                    hash: await hashPasswordMaterial(new TextEncoder().encode('member password factor')),
                },
            },
        });
        const membershipBefore = await db.teamMembership.findUniqueOrThrow({
            where: { teamId_accountId: { teamId: team.id, accountId: account.id } },
        });

        const projection = await resolveAuthEntry(
            { v: 1, scope: { kind: 'team', teamId: team.id } },
            context,
        );

        expect(projection).toEqual({
            v: 1,
            state: 'already_member',
            scope: { kind: 'team' },
            home: { serverId: expect.any(String), displayName: null, storageMode: null },
            account: { firstName: null, lastName: null, username: null, avatarUrl: null },
            team: { teamId: team.id, name: 'Restricted Evidence Team', logo: null },
            actions: [{ kind: 'continue' }],
            autoRedirect: null,
        });
        expect(await db.teamMembership.findUniqueOrThrow({
            where: { teamId_accountId: { teamId: team.id, accountId: account.id } },
        })).toEqual(membershipBefore);
    });

    afterAll(async () => {
        if (harness) await harness.close();
    });

    it('projects an active invitation through the Home method owner without exposing invitation authority', async () => {
        const team = await activeInvitation();
        const projection = await resolveAuthEntry(
            { v: 1, scope: { kind: 'invitation', token: INVITATION_TOKEN } },
            {
                env: {
                    HAPPIER_FEATURE_AUTH_EMAIL_PASSWORD__ENABLED: '1',
                    HAPPIER_AUTH_SIGN_IN_SERVICE_MODE: 'self',
                    HAPPIER_FEATURE_ACCOUNT_DIRECTORY__ENABLED: '1',
                },
            },
        );

        expect(projection).toMatchObject({
            v: 1,
            state: 'admission_required',
            scope: { kind: 'invitation' },
            team: { teamId: team.id, name: 'Acme', logo: null },
            invitationEmailVerificationRequired: false,
            autoRedirect: null,
        });
        if (projection.state !== 'admission_required') throw new Error('expected invitation admission');
        expect(projection.actions).toEqual(expect.arrayContaining([
            expect.objectContaining({ methodId: 'email_password', action: 'login', origin: 'home' }),
        ]));
        expect(JSON.stringify(projection)).not.toContain(INVITATION_TOKEN);
        expect(JSON.stringify(projection)).not.toContain('role');
        expect(JSON.stringify(projection)).not.toContain('historyAccess');
        expect(JSON.stringify(projection)).not.toContain('recipientEmail');
        expect(projection).not.toHaveProperty('currentAccountRecipientStatus');
    });

    it('projects whether the addressed invitation mailbox is already verified by this Account', async () => {
        await activeInvitation();
        const account = await db.account.create({ data: {
            publicKey: crypto.randomUUID(),
            encryptionMode: 'plain',
        } });
        const context = {
            env: {
                HAPPIER_FEATURE_TEAMS__ENABLED: '1',
                HAPPIER_FEATURE_AUTH_EMAIL_PASSWORD__ENABLED: '1',
            },
            principal: { accountId: account.id },
        } as const;

        const before = await resolveAuthEntry(
            { v: 1, scope: { kind: 'invitation', token: INVITATION_TOKEN } },
            context,
        );
        expect(before).toMatchObject({
            currentAccountRecipientStatus: 'verification_required',
            actions: expect.arrayContaining([{ kind: 'switch_account' }]),
        });
        expect(JSON.stringify(before)).not.toContain('invited@example.test');

        await db.accountEmail.create({ data: {
            accountId: account.id,
            address: 'Invited@Example.Test',
            normalizedEmail: 'invited@example.test',
        } });
        const after = await resolveAuthEntry(
            { v: 1, scope: { kind: 'invitation', token: INVITATION_TOKEN } },
            context,
        );
        expect(after).toMatchObject({ currentAccountRecipientStatus: 'already_verified' });
        if (after.state !== 'admission_required') throw new Error('expected invitation admission');
        expect(after.actions).not.toContainEqual({ kind: 'switch_account' });
    });

    it('projects an authenticated effective member as already admitted without consuming the invitation', async () => {
        const team = await activeInvitation();
        const account = await member(team.id);

        const projection = await resolveAuthEntry(
            { v: 1, scope: { kind: 'invitation', token: INVITATION_TOKEN } },
            {
                env: {
                    HAPPIER_FEATURE_TEAMS__ENABLED: '1',
                    HAPPIER_FEATURE_AUTH_EMAIL_PASSWORD__ENABLED: '1',
                },
                principal: { accountId: account.id },
            },
        );

        expect(projection).toEqual({
            v: 1,
            state: 'already_member',
            scope: { kind: 'invitation' },
            home: { serverId: expect.any(String), displayName: null, storageMode: 'encrypted' },
            account: { firstName: null, lastName: null, username: null, avatarUrl: null },
            team: { teamId: team.id, name: 'Acme', logo: null },
            actions: [{ kind: 'continue' }],
            autoRedirect: null,
        });
        expect(await db.teamInvitation.findFirstOrThrow({
            where: { tokenHash: Uint8Array.from(digestTeamInvitationToken(INVITATION_TOKEN)) },
        })).toMatchObject({ acceptedAt: null, acceptedByAccountId: null });
    });

    it('projects transferable invitation mailbox verification as a server-owned admission fact', async () => {
        await activeInvitation();
        await db.teamInvitation.updateMany({
            where: { tokenHash: Uint8Array.from(digestTeamInvitationToken(INVITATION_TOKEN)) },
            data: { recipientEmailNormalized: null },
        });

        const projection = await resolveAuthEntry(
            { v: 1, scope: { kind: 'invitation', token: INVITATION_TOKEN } },
            { env: { HAPPIER_FEATURE_TEAMS__ENABLED: '1', HAPPIER_FEATURE_AUTH_EMAIL_PASSWORD__ENABLED: '1' } },
        );

        expect(projection).toMatchObject({ invitationEmailVerificationRequired: true });
    });

    it('resolves a fresh-document verification bearer through its current transferable invitation context', async () => {
        const team = await activeInvitation();
        await db.teamInvitation.updateMany({
            where: { tokenHash: Uint8Array.from(digestTeamInvitationToken(INVITATION_TOKEN)) },
            data: { recipientEmailNormalized: null },
        });
        await db.homeGovernancePolicy.create({ data: {
            id: 'home',
            authenticationPolicy: {
                v: 1,
                enabledMethodIds: ['email_password'],
                admission: 'invitation_only',
            },
        } });
        const issued = await inTx(async (tx) => issueNativeAuthOneTimeOperationInTx(tx, {
            v: 1,
            purpose: 'verify_native_email',
            normalizedEmail: 'person@example.test',
            consumer: {
                kind: 'team_invitation',
                invitationId: (await tx.teamInvitation.findFirstOrThrow({
                    where: { teamId: team.id }, select: { id: true },
                })).id,
                tokenHash: Buffer.from(digestTeamInvitationToken(INVITATION_TOKEN)).toString('hex'),
                teamId: team.id,
            },
        }));

        const projection = await resolveAuthEntry(
            { v: 1, scope: { kind: 'native_email_verification', token: issued.rawBearer } },
            {
                env: {
                    HAPPIER_FEATURE_TEAMS__ENABLED: '1',
                    HAPPIER_FEATURE_AUTH_EMAIL_PASSWORD__ENABLED: '1',
                    HAPPIER_FEATURE_AUTH_EMAIL_PASSWORD__PROVISION_ENABLED: '1',
                },
                emailDeliveryReady: true,
            },
        );

        expect(projection).toMatchObject({
            state: 'admission_required',
            scope: { kind: 'invitation' },
            team: { teamId: team.id },
            actions: expect.arrayContaining([
                expect.objectContaining({ methodId: 'email_password', action: 'provision' }),
            ]),
        });
        expect(JSON.stringify(projection)).not.toContain(issued.rawBearer);
        expect(JSON.stringify(projection)).not.toContain(INVITATION_TOKEN);
        expect(JSON.stringify(projection)).not.toContain('tokenHash');
        expect(JSON.stringify(projection)).not.toContain('invitationId');

        await db.teamInvitation.updateMany({
            where: { teamId: team.id }, data: { revokedAt: new Date() },
        });
        await expect(resolveAuthEntry(
            { v: 1, scope: { kind: 'native_email_verification', token: issued.rawBearer } },
            { env: { HAPPIER_FEATURE_TEAMS__ENABLED: '1' }, emailDeliveryReady: true },
        )).resolves.toEqual({
            v: 1,
            state: 'unavailable',
            scope: { kind: 'invitation' },
            reason: 'entry_not_available',
            autoRedirect: null,
        });
        expect(await inTx((tx) => readNativeAuthOneTimeOperation(tx, {
            purpose: 'verify_native_email', token: issued.rawBearer,
        }))).not.toBeNull();
        expect(await db.account.count()).toBe(0);
        expect(await db.teamMembership.count()).toBe(0);

        await db.teamInvitation.updateMany({
            where: { teamId: team.id }, data: { revokedAt: null },
        });

        await inTx((tx) => consumeNativeAuthOneTimeOperationInTx(tx, {
            purpose: 'verify_native_email', token: issued.rawBearer,
        }));
        await expect(resolveAuthEntry(
            { v: 1, scope: { kind: 'native_email_verification', token: issued.rawBearer } },
            { env: { HAPPIER_FEATURE_TEAMS__ENABLED: '1' }, emailDeliveryReady: true },
        )).resolves.toEqual({
            v: 1,
            state: 'unavailable',
            scope: { kind: 'invitation' },
            reason: 'entry_not_available',
            autoRedirect: null,
        });
        expect(await db.account.count()).toBe(0);
        expect(await db.teamMembership.count()).toBe(0);
    });

    it('collapses an inactive invitation and disabled Teams to the same unavailable result', async () => {
        const expected = {
            v: 1,
            state: 'unavailable',
            scope: { kind: 'invitation' },
            reason: 'entry_not_available',
            autoRedirect: null,
        } as const;

        await expect(resolveAuthEntry(
            { v: 1, scope: { kind: 'invitation', token: INVITATION_TOKEN } },
            { env: {} },
        )).resolves.toEqual(expected);

        await activeInvitation();
        await expect(resolveAuthEntry(
            { v: 1, scope: { kind: 'invitation', token: INVITATION_TOKEN } },
            {
                env: { HAPPIER_FEATURE_TEAMS__ENABLED: '0' },
            },
        )).resolves.toEqual(expected);
    });

    it('fails a restricted Team invitation closed until credential evidence is owned by Homes', async () => {
        await activeInvitation({
            v: 1, mode: 'restricted',
            accepted: [{ kind: 'team_connection', connectionId: 'connection-1' }],
        });
        await expect(resolveAuthEntry(
            { v: 1, scope: { kind: 'invitation', token: INVITATION_TOKEN } },
            {
                env: {},
            },
        )).resolves.toEqual({
            v: 1,
            state: 'unavailable',
            scope: { kind: 'invitation' },
            reason: 'entry_not_available',
            autoRedirect: null,
        });
    });

    it('passes invitation admission through the canonical restricted Home-method decision', async () => {
        await activeInvitation({
            v: 1,
            mode: 'restricted',
            accepted: [{ kind: 'home_method', methodId: 'email_password' }],
        });
        await db.homeGovernancePolicy.create({ data: {
            id: 'home',
            authenticationPolicy: {
                v: 1,
                enabledMethodIds: ['email_password'],
                admission: 'invitation_only',
            },
        } });
        const projection = await resolveAuthEntry(
            { v: 1, scope: { kind: 'invitation', token: INVITATION_TOKEN } },
            {
                env: {
                    HAPPIER_FEATURE_AUTH_EMAIL_PASSWORD__ENABLED: '1',
                    HAPPIER_FEATURE_AUTH_EMAIL_PASSWORD__PROVISION_ENABLED: '1',
                },
                emailDeliveryReady: true,
            },
        );

        expect(projection.state).toBe('admission_required');
        if (projection.state !== 'admission_required') throw new Error('expected invitation admission');
        expect(projection.actions).toEqual(expect.arrayContaining([
            expect.objectContaining({
                methodId: 'email_password',
                action: 'provision',
                origin: 'home',
            }),
        ]));
    });

    it('treats an explicit inherit document as inherited Home authentication', async () => {
        await activeInvitation({ v: 1, mode: 'inherit' });
        const projection = await resolveAuthEntry(
            { v: 1, scope: { kind: 'invitation', token: INVITATION_TOKEN } },
            {
                env: { HAPPIER_FEATURE_AUTH_EMAIL_PASSWORD__ENABLED: '1' },
            },
        );

        expect(projection.state).toBe('admission_required');
    });
    it('projects native and provider actions with their exact action/mode pairs', async () => {
        const projection = await resolveAuthEntry(
            { v: 1, scope: { kind: 'home' } },
            {
                env: {
                    HAPPIER_FEATURE_AUTH_EMAIL_PASSWORD__ENABLED: '1',
                    HAPPIER_FEATURE_AUTH_LOGIN__KEY_CHALLENGE_ENABLED: '1',
                    AUTH_SIGNUP_PROVIDERS: 'acme',
                    AUTH_PROVIDERS_CONFIG_JSON: JSON.stringify([oidcEntry('acme')]),
                },
                principal: { accountId: 'account-without-row' },
            },
        );

        expect(projection.state).toBe('ready');
        if (projection.state !== 'ready') throw new Error('expected ready projection');
        expect(projection.actions).toEqual(expect.arrayContaining([
            expect.objectContaining({ methodId: 'email_password', action: 'login', mode: 'keyed' }),
            expect.objectContaining({ methodId: 'acme', action: 'connect', mode: 'either' }),
            expect.objectContaining({ methodId: 'acme', action: 'provision', mode: 'keyed' }),
        ]));
        expect(JSON.stringify(projection)).not.toContain('client-secret-is-private');
        expect(JSON.stringify(projection)).not.toContain('client-id-is-private');
    });

    it('fails account-service purpose closed when the Home is not an Account Directory', async () => {
        const projection = await resolveAuthEntry(
            { v: 1, scope: { kind: 'home' }, purpose: 'account_service' },
            { env: {} },
        );

        expect(projection).toEqual({
            v: 1,
            state: 'unavailable',
            scope: { kind: 'home' },
            reason: 'not_account_service',
            autoRedirect: null,
        });
    });

    it('does not advertise self sign-in service when Account Directory is unavailable', async () => {
        const projection = await resolveAuthEntry(
            { v: 1, scope: { kind: 'home' } },
            { env: { HAPPIER_AUTH_SIGN_IN_SERVICE_MODE: 'self' } },
        );

        expect(projection).not.toHaveProperty('signInService');
    });

    it('orders provider actions by immutable provider id regardless of deployment configuration order', async () => {
        const projectProviderIds = async (providers: readonly Record<string, unknown>[]) => {
            const projection = await resolveAuthEntry(
                { v: 1, scope: { kind: 'home' } },
                {
                    env: {
                        AUTH_SIGNUP_PROVIDERS: 'zeta,alpha',
                        AUTH_PROVIDERS_CONFIG_JSON: JSON.stringify(providers),
                    },
                    principal: { accountId: 'account-without-row' },
                },
            );
            if (projection.state !== 'ready') throw new Error('expected ready projection');
            return projection.actions
                .filter((action) => action.methodId === 'alpha' || action.methodId === 'zeta')
                .map((action) => `${action.methodId}:${action.action}:${action.mode}`);
        };
        const alpha = { ...oidcEntry('alpha'), displayName: 'Alpha' };
        const zeta = { ...oidcEntry('zeta'), displayName: 'Zeta' };

        await expect(projectProviderIds([zeta, alpha])).resolves.toEqual(
            await projectProviderIds([alpha, zeta]),
        );
        await expect(projectProviderIds([zeta, alpha])).resolves.toEqual([
            'alpha:connect:either',
            'alpha:provision:keyed',
            'zeta:connect:either',
            'zeta:provision:keyed',
        ]);
    });

    it('returns an unavailable terminal result instead of emitting a partial oversized projection', async () => {
        const projection = await resolveAuthEntry(
            { v: 1, scope: { kind: 'home' } },
            {
                env: {
                    AUTH_PROVIDERS_CONFIG_JSON: JSON.stringify([{
                        ...oidcEntry('oversized'),
                        displayName: 'x'.repeat(FEATURES_RESPONSE_MAX_UTF8_BYTES_V1),
                    }]),
                },
                principal: { accountId: 'account-without-row' },
            },
        );

        expect(projection).toEqual({
            v: 1,
            state: 'unavailable',
            scope: { kind: 'home' },
            reason: 'authentication_policy_unavailable',
            autoRedirect: null,
        });
    });

    it('offers connect actions only to a request that carries an authenticated principal', async () => {
        const env = {
            HAPPIER_FEATURE_AUTH_EMAIL_PASSWORD__ENABLED: '1',
            HAPPIER_FEATURE_AUTH_LOGIN__KEY_CHALLENGE_ENABLED: '1',
        };
        await activeInvitation();

        const anonymous = await resolveAuthEntry({ v: 1, scope: { kind: 'home' } }, { env });
        const authenticated = await resolveAuthEntry(
            { v: 1, scope: { kind: 'home' } },
            { env, principal: { accountId: 'account-without-row' } },
        );
        const invitation = await resolveAuthEntry(
            { v: 1, scope: { kind: 'invitation', token: INVITATION_TOKEN } },
            { env },
        );

        if (anonymous.state !== 'ready' || authenticated.state !== 'ready') throw new Error('expected ready projections');
        if (invitation.state !== 'admission_required') throw new Error('expected invitation admission');
        expect(anonymous.actions).not.toContainEqual(expect.objectContaining({ action: 'connect' }));
        expect(anonymous.actions).toContainEqual(expect.objectContaining({ methodId: 'email_password', action: 'login' }));
        expect(invitation.actions).not.toContainEqual(expect.objectContaining({ action: 'connect', origin: 'home' }));
        expect(authenticated.actions).toContainEqual(expect.objectContaining({
            methodId: 'email_password',
            action: 'connect',
            origin: 'home',
        }));
    });

    it('keeps Team and invitation entry open while an accepted connection still awaits its activation test', async () => {
        await db.homeGovernancePolicy.create({
            data: {
                id: 'home',
                teamProviderPolicy: {
                    v: 1,
                    allowedTeamProviderKinds: ['oidc'],
                    teamJitAllowed: false,
                    approvedGitHubEnterpriseOrigins: [],
                },
            },
        });
        const team = await db.team.create({ data: { name: 'Untested Team' } });
        const provider = await db.identityProviderInstance.create({
            data: {
                ownerTeamId: team.id,
                kind: 'oidc',
                displayName: 'Untested SSO',
                enabled: true,
                firstEnabledAt: new Date('2026-09-06T00:00:00.000Z'),
                config: MANAGED_OIDC_CONFIG,
            },
        });
        const connection = await db.teamIdentityConnection.create({
            data: {
                teamId: team.id,
                providerInstanceId: provider.id,
                externalReference: { v: 1, kind: 'oidc' },
                settings: {
                    v: 1,
                    kind: 'oidc',
                    allowedUsers: [],
                    allowedEmailDomains: [],
                    groupsAny: [],
                    groupsAll: [],
                },
                enabled: true,
                firstEnabledAt: new Date('2026-09-06T00:00:00.000Z'),
            },
        });
        await db.team.update({
            where: { id: team.id },
            data: {
                authenticationPolicy: {
                    v: 1,
                    mode: 'restricted',
                    accepted: [{ kind: 'team_connection', connectionId: connection.id }],
                },
            },
        });
        await inTx((tx) => createTeamInvitationInTx(tx, {
            teamId: team.id, role: 'member', historyAccess: 'from_membership',
            createdByAccountId: null, recipientEmailNormalized: 'invited@example.test',
            tokenHash: digestTeamInvitationToken(INVITATION_TOKEN), now: new Date(),
        }));
        const env = {
            HAPPIER_FEATURE_TEAMS__ENABLED: '1',
            HAPPIER_PUBLIC_SERVER_URL: 'https://home.example.test',
        };

        const teamEntry = await resolveAuthEntry({ v: 1, scope: { kind: 'team', teamId: team.id } }, { env });
        const invitationEntry = await resolveAuthEntry(
            { v: 1, scope: { kind: 'invitation', token: INVITATION_TOKEN } },
            { env },
        );

        for (const projection of [teamEntry, invitationEntry]) {
            expect(projection.state).toBe('admission_required');
            if (projection.state !== 'admission_required') throw new Error('expected admission');
            expect(projection.actions).toContainEqual(expect.objectContaining({
                methodId: provider.id,
                action: 'connect',
                origin: 'team',
            }));
        }
    });

    it('offers native provisioning on the Team page when transactional mail is ready', async () => {
        const team = await db.team.create({ data: { name: 'Open Team' } });

        const projection = await resolveAuthEntry(
            { v: 1, scope: { kind: 'team', teamId: team.id } },
            {
                env: {
                    HAPPIER_FEATURE_TEAMS__ENABLED: '1',
                    HAPPIER_FEATURE_AUTH_EMAIL_PASSWORD__ENABLED: '1',
                    HAPPIER_FEATURE_AUTH_EMAIL_PASSWORD__PROVISION_ENABLED: '1',
                },
                emailDeliveryReady: true,
            },
        );

        expect(projection.state).toBe('admission_required');
        if (projection.state !== 'admission_required') throw new Error('expected Team admission');
        expect(projection.actions).toContainEqual(expect.objectContaining({
            methodId: 'email_password',
            action: 'provision',
            origin: 'home',
        }));
    });

    it('withholds provisioning that the public-signup policy denies for the requesting address', async () => {
        const env = {
            HAPPIER_FEATURE_AUTH_EMAIL_PASSWORD__ENABLED: '1',
            HAPPIER_FEATURE_AUTH_EMAIL_PASSWORD__PROVISION_ENABLED: '1',
            HAPPIER_AUTH_PUBLIC_PROVISION_DENY_METHODS: 'email_password',
        };

        const publicVisitor = await resolveAuthEntry(
            { v: 1, scope: { kind: 'home' } },
            { env, emailDeliveryReady: true, requestIp: '8.8.8.8' },
        );
        const privateVisitor = await resolveAuthEntry(
            { v: 1, scope: { kind: 'home' } },
            { env, emailDeliveryReady: true, requestIp: '10.0.0.9' },
        );

        if (publicVisitor.state !== 'ready' || privateVisitor.state !== 'ready') throw new Error('expected ready projections');
        expect(publicVisitor.actions).not.toContainEqual(expect.objectContaining({ methodId: 'email_password', action: 'provision' }));
        expect(publicVisitor.actions).toContainEqual(expect.objectContaining({ methodId: 'email_password', action: 'login' }));
        expect(privateVisitor.actions).toContainEqual(expect.objectContaining({ methodId: 'email_password', action: 'provision' }));
    });

    it('keeps a restricted Team open through its other accepted alternatives when the Home does not offer one', async () => {
        // The Home prohibits the connection's provider kind, so the catalog omits it:
        // that accepted reference is currently not offered, which must not turn the
        // whole Team policy (and the other accepted Home method) unavailable.
        await db.homeGovernancePolicy.create({
            data: {
                id: 'home',
                teamProviderPolicy: {
                    v: 1,
                    allowedTeamProviderKinds: ['github_app_identity'],
                    teamJitAllowed: false,
                    approvedGitHubEnterpriseOrigins: [],
                },
            },
        });
        const team = await db.team.create({ data: { name: 'Narrowed Team' } });
        const provider = await db.identityProviderInstance.create({
            data: {
                ownerTeamId: team.id,
                kind: 'oidc',
                displayName: 'Prohibited SSO',
                enabled: true,
                firstEnabledAt: new Date('2026-09-06T00:00:00.000Z'),
                config: MANAGED_OIDC_CONFIG,
            },
        });
        const connection = await db.teamIdentityConnection.create({
            data: {
                teamId: team.id,
                providerInstanceId: provider.id,
                externalReference: { v: 1, kind: 'oidc' },
                settings: {
                    v: 1,
                    kind: 'oidc',
                    allowedUsers: [],
                    allowedEmailDomains: [],
                    groupsAny: [],
                    groupsAll: [],
                },
                enabled: true,
                firstEnabledAt: new Date('2026-09-06T00:00:00.000Z'),
            },
        });
        await db.team.update({
            where: { id: team.id },
            data: {
                authenticationPolicy: {
                    v: 1,
                    mode: 'restricted',
                    accepted: [
                        { kind: 'team_connection', connectionId: connection.id },
                        { kind: 'home_method', methodId: 'email_password' },
                    ],
                },
            },
        });

        const projection = await resolveAuthEntry(
            { v: 1, scope: { kind: 'team', teamId: team.id } },
            {
                env: {
                    HAPPIER_FEATURE_TEAMS__ENABLED: '1',
                    HAPPIER_PUBLIC_SERVER_URL: 'https://home.example.test',
                    HAPPIER_FEATURE_AUTH_EMAIL_PASSWORD__ENABLED: '1',
                },
            },
        );

        expect(projection.state).toBe('admission_required');
        if (projection.state !== 'admission_required') throw new Error('expected Team admission');
        expect(projection.actions).toContainEqual(expect.objectContaining({
            methodId: 'email_password',
            action: 'login',
            origin: 'home',
        }));
        expect(projection.actions).not.toContainEqual(expect.objectContaining({ methodId: provider.id, origin: 'team' }));
    });
});
