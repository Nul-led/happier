import { projectLegacySessionAccessCapabilitiesV1 } from '@happier-dev/protocol';
import { describe, expect, it } from 'vitest';

import { createSessionFixture } from '@/dev/testkit/fixtures/sessionFixtures';
import { readSessionOwnerMetadataView } from '@/sync/domains/session/readSessionOwnerMetadataView';

import { buildSessionListRenderableFromSession } from './sessionListRenderable';
import { buildSessionFromListRenderable } from './sessionListRenderableSessionProjection';

describe('buildSessionFromListRenderable', () => {
    it('preserves the safe responsible Account summary through list renderable reconstruction', () => {
        const responsibleAccount = {
            kind: 'account' as const,
            accountId: 'account-alice',
            firstName: 'Alice',
            lastName: null,
            username: 'alice',
            avatarUrl: null,
        };
        const source = createSessionFixture({
            id: 'assigned-session',
            responsibleAccountId: responsibleAccount.accountId,
            responsibleAccount,
        });

        const renderable = buildSessionListRenderableFromSession(source);
        expect(renderable.responsibleAccountId).toBe(responsibleAccount.accountId);
        expect(renderable.responsibleAccount).toEqual(responsibleAccount);

        const reconstructed = buildSessionFromListRenderable(renderable);
        expect(reconstructed.responsibleAccountId).toBe(responsibleAccount.accountId);
        expect(reconstructed.responsibleAccount).toEqual(responsibleAccount);
    });

    it('keeps omitted and explicit-null responsibility summaries distinct', () => {
        const omitted = buildSessionListRenderableFromSession(createSessionFixture({
            id: 'unsupported-session',
        }));
        const unassigned = buildSessionListRenderableFromSession(createSessionFixture({
            id: 'unassigned-session',
            responsibleAccountId: null,
            responsibleAccount: null,
        }));

        expect('responsibleAccount' in omitted).toBe(false);
        expect(unassigned.responsibleAccount).toBeNull();
        expect('responsibleAccount' in buildSessionFromListRenderable(omitted)).toBe(false);
        expect(buildSessionFromListRenderable(unassigned).responsibleAccount).toBeNull();
    });

    it('reconstructs a layout-v1 owner metadata view without exposing it to recipients', () => {
        const ownerMetadata = {
            path: '/home/alice/project',
            homeDir: '/home/alice',
            host: 'workstation',
            machineId: 'machine-a',
        };
        const renderable = buildSessionListRenderableFromSession(createSessionFixture({
            id: 'layout-v1-owner',
            metadataLayoutVersion: 1,
            metadata: null,
            ownerMetadataView: ownerMetadata,
            access: {
                role: 'owner',
                level: 'owner',
                capabilities: projectLegacySessionAccessCapabilitiesV1({
                    level: 'owner',
                    canApprovePermissions: true,
                }),
            },
        }));

        const ownerSession = buildSessionFromListRenderable(renderable);
        expect(ownerSession.metadataLayoutVersion).toBe(1);
        expect(readSessionOwnerMetadataView(ownerSession)).toMatchObject(ownerMetadata);

        const recipientSession = buildSessionFromListRenderable({
            ...renderable,
            access: {
                role: 'recipient',
                level: 'view',
                capabilities: projectLegacySessionAccessCapabilitiesV1({ level: 'view' }),
            },
            accessLevel: 'view',
        });
        expect(recipientSession.metadataLayoutVersion).toBe(1);
        expect(recipientSession.ownerMetadataView).toBeNull();
        expect(readSessionOwnerMetadataView(recipientSession)).toBeNull();
    });
});
