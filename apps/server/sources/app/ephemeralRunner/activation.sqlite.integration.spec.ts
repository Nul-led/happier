import { randomUUID } from 'node:crypto';

import Fastify from 'fastify';
import rateLimit from '@fastify/rate-limit';
import { serializerCompiler, validatorCompiler, ZodTypeProvider } from 'fastify-type-provider-zod';
import tweetnacl from 'tweetnacl';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { encodeBase64 } from '@happier-dev/protocol';

import { registerApiRoutes } from '@/app/api/api';
import { enableAuthentication } from '@/app/api/utils/enableAuthentication';
import { auth } from '@/app/auth/auth';
import { mutateSessionDraft } from '@/app/account/sessionDrafts/sessionDraftService';
import { db } from '@/storage/db';
import { createLightSqliteHarness, type LightSqliteHarness } from '@/testkit/lightSqliteHarness';

describe('ephemeral Runner activation (SQLite integration)', () => {
    let harness: LightSqliteHarness;

    beforeAll(async () => {
        harness = await createLightSqliteHarness({
            tempDirPrefix: 'happier-runner-activation-',
            initAuth: true,
            env: {
                HAPPIER_SERVER_IDENTITY_ID: 'srv_runner_activation_test',
                HAPPIER_FEATURE_SESSIONS_EPHEMERAL_RUNNER__ENABLED: '1',
            },
        });
    }, 120_000);

    afterAll(async () => harness?.close());

    it('reports a positively absent Runner artifact without creating activation or runtime resources', async () => {
        const account = await db.account.create({ data: { encryptionMode: 'plain' } });
        const draftId = randomUUID();
        const mutationId = randomUUID();
        await mutateSessionDraft({
            accountId: account.id,
            address: { kind: 'newSession', draftId },
            authentication: { env: process.env, authority: 'present_user', authenticationEvidence: undefined },
            expectedRevision: 'absent',
            content: {
                t: 'plain',
                v: {
                    v: 1,
                    address: { kind: 'newSession', draftId },
                    document: {
                        v: 1,
                        composer: {
                            text: { mutationId, value: 'Inspect the project' },
                            mentions: { mutationId, value: [] },
                            attachments: { mutationId, value: [] },
                        },
                        target: { kind: 'newSession', authoring: {} },
                        extensions: {},
                    },
                },
            },
        });
        const token = await auth.createToken(account.id, undefined, { kind: 'account', authority: 'present_user' });
        const app = Fastify({ logger: false });
        app.register(rateLimit, { global: false });
        app.setValidatorCompiler(validatorCompiler);
        app.setSerializerCompiler(serializerCompiler);
        const typed = app.withTypeProvider<ZodTypeProvider>();
        enableAuthentication(typed);
        registerApiRoutes(typed);
        await app.ready();
        // Artifact acquisition is the external boundary; no published release is fabricated.
        vi.stubGlobal('fetch', async () => new Response('', { status: 404 }));
        try {
            const body = {
                v: 1,
                activationId: randomUUID(),
                draftId,
                homeServerIdentityId: 'srv_runner_activation_test',
                activationSigningPublicKey: encodeBase64(tweetnacl.sign.keyPair().publicKey, 'base64url'),
                activationExpiresAt: null,
                workspace: { kind: 'choose_on_endpoint' as const },
                authoringCommitment: encodeBase64(tweetnacl.randomBytes(32), 'base64url'),
                artifact: { product: 'happier-runner', version: '0.3.0', target: 'linux-x64', sha256: 'a'.repeat(64) },
                endpointFactsRecipient: { mode: 'plain', creatorAccountId: account.id },
            };
            const response = await app.inject({
                method: 'POST', url: '/v1/ephemeral-runners/activations',
                headers: { authorization: `Bearer ${token}` }, payload: body,
            });
            expect(response.statusCode).toBe(404);
            expect(response.json()).toEqual({ error: 'runner_artifact_not_published' });
            expect(await db.session.count()).toBe(0);
            expect(await db.machine.count()).toBe(0);
            expect(await db.accessKey.count()).toBe(0);
        } finally {
            vi.unstubAllGlobals();
            await app.close();
        }
    });
});
