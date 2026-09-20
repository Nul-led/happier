import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { db } from '@/storage/db';
import { inTx } from '@/storage/inTx';
import { createLightSqliteHarness, type LightSqliteHarness } from '@/testkit/lightSqliteHarness';
import { hashPasswordMaterial } from '@/app/auth/password/passwordMaterialVerifier';

import { qualifyTeamAuthenticationInTx } from './qualifyTeamAuthentication';

const ACCEPTED_EMAIL_PASSWORD = { kind: 'home_method' as const, methodId: 'email_password' };
const EMAIL_PASSWORD_EVIDENCE = [{ kind: 'home_method' as const, methodId: 'email_password' }];
const MANAGED_OIDC_CONFIG = {
    v: 1,
    kind: 'oidc',
    issuer: 'https://id.example.test',
    clientId: 'happier',
    clientAuthenticationMethod: 'client_secret_post',
    scopes: 'openid profile email',
    httpTimeoutSeconds: 30,
    claims: { login: 'preferred_username', email: 'email', groups: 'groups' },
    allow: { usersAllowlist: [], emailDomains: [], groupsAny: [], groupsAll: [] },
    fetchUserInfo: true,
    storeRefreshToken: false,
    ui: { buttonColor: null, iconHint: 'oidc' },
} as const;
const HOME_OFFERS_EMAIL_PASSWORD = {
    HAPPIER_FEATURE_AUTH_EMAIL_PASSWORD__ENABLED: '1',
    HAPPIER_FEATURE_E2EE__KEYLESS_ACCOUNTS_ENABLED: '1',
    HAPPIER_FEATURE_ENCRYPTION__STORAGE_POLICY: 'optional',
};

describe('qualifyTeamAuthenticationInTx', () => {
    let harness: LightSqliteHarness;

    beforeAll(async () => {
        harness = await createLightSqliteHarness({
            tempDirPrefix: 'happier-team-qualification-',
            initAuth: false,
            initEncrypt: true,
            initFiles: false,
        });
    }, 180_000);

    afterEach(async () => {
        await db.accountPasswordCredential.deleteMany({});
        await db.accountIdentity.deleteMany({});
        await db.teamIdentityConnection.deleteMany({});
        await db.identityProviderInstance.deleteMany({});
        await db.teamMembership.deleteMany({});
        await db.team.deleteMany({});
        await db.account.deleteMany({});
        await db.homeGovernancePolicy.deleteMany({});
    });

    afterAll(async () => {
        if (harness) await harness.close();
    });

    async function restrictedTeam() {
        return await db.team.create({
            data: {
                name: 'Restricted',
                authenticationPolicy: { v: 1, mode: 'restricted', accepted: [ACCEPTED_EMAIL_PASSWORD] },
            },
        });
    }

    async function qualify(env: NodeJS.ProcessEnv, team: { id: string; authenticationPolicy: unknown }, accountId: string) {
        return await inTx((tx) => qualifyTeamAuthenticationInTx(tx, {
            env,
            team,
            accountId,
            verifiedCredentialEvidence: EMAIL_PASSWORD_EVIDENCE,
            operationContext: { kind: 'present_user' },
        }));
    }

    it('answers unavailable when the Home cannot currently offer any accepted method', async () => {
        const team = await restrictedTeam();
        const account = await db.account.create({ data: { publicKey: null, encryptionMode: 'plain' } });

        // Structurally valid policy, but the operator has turned email/password off
        // on this Home — the method is on by default, so the opt-out is explicit.
        // Nothing the caller can present would satisfy it, so this is not an
        // authentication request.
        await expect(qualify({
            HAPPIER_FEATURE_ENCRYPTION__STORAGE_POLICY: 'optional',
            HAPPIER_FEATURE_AUTH_EMAIL_PASSWORD__ENABLED: '0',
        }, team, account.id)).resolves.toEqual({ status: 'unavailable' });
    });

    it('asks for authentication when an offered accepted method has no current evidence for this Account', async () => {
        const team = await restrictedTeam();
        const account = await db.account.create({ data: { publicKey: null, encryptionMode: 'plain' } });

        // The Home offers email/password, but this Account holds no password
        // factor, so the claimed evidence is not current for it.
        await expect(qualify(HOME_OFFERS_EMAIL_PASSWORD, team, account.id)).resolves.toEqual({
            status: 'authentication_required',
            accepted: [ACCEPTED_EMAIL_PASSWORD],
        });
    });

    it('is satisfied by current evidence of an offered accepted method', async () => {
        const team = await restrictedTeam();
        const account = await db.account.create({ data: { publicKey: null, encryptionMode: 'plain' } });
        await db.accountIdentity.create({
            data: { accountId: account.id, provider: 'email', providerUserId: 'member@example.test', profile: {} },
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

        await expect(qualify(HOME_OFFERS_EMAIL_PASSWORD, team, account.id)).resolves.toEqual({
            status: 'satisfied',
            matched: ACCEPTED_EMAIL_PASSWORD,
        });
    });

    it('asks for authentication through the remaining offered alternative when the Home does not offer an accepted connection', async () => {
        // No Home team-provider allowance exists, so the catalog does not offer the
        // connection: that accepted reference is not usable, but it is not unreadable
        // and must not hide the accepted Home method that still works.
        const team = await db.team.create({ data: { name: 'Narrowed' } });
        const provider = await db.identityProviderInstance.create({
            data: {
                ownerTeamId: team.id,
                kind: 'oidc',
                displayName: 'Not offered SSO',
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
                settings: { v: 1, kind: 'oidc', allowedUsers: [], allowedEmailDomains: [], groupsAny: [], groupsAll: [] },
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
                    accepted: [{ kind: 'team_connection', connectionId: connection.id }, ACCEPTED_EMAIL_PASSWORD],
                },
            },
        });
        const account = await db.account.create({ data: { publicKey: null, encryptionMode: 'plain' } });

        await expect(qualify(
            { ...HOME_OFFERS_EMAIL_PASSWORD, HAPPIER_PUBLIC_SERVER_URL: 'https://home.example.test' },
            { id: team.id, authenticationPolicy: (await db.team.findUniqueOrThrow({ where: { id: team.id } })).authenticationPolicy },
            account.id,
        )).resolves.toEqual({
            status: 'authentication_required',
            accepted: [ACCEPTED_EMAIL_PASSWORD],
        });
    });
});
