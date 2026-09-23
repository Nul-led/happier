import { beforeEach, describe, expect, it, vi } from 'vitest';
import tweetnacl from 'tweetnacl';
import { readHappierStructuredInputV1FromMeta } from '@happier-dev/protocol';
import { computeRunnerAuthoringCommitmentV1, type RunnerPreparedAuthoringV1 } from '@happier-dev/protocol/ephemeralRunner/launchManifest';
import type { RunnerActivationProjectionV1 } from '@happier-dev/protocol/ephemeralRunner/projection';

const boundaries = vi.hoisted(() => ({
    localValues: new Map<string, string>(),
    stagedBytes: new Map<string, Uint8Array>(),
    removedUris: [] as string[],
    sinkSequence: 0,
    followUps: [] as unknown[],
    events: [] as string[],
}));

vi.mock('@/auth/storage/deviceLocalStorage', () => ({
    readDeviceLocalStorageString: async (key: string) => boundaries.localValues.get(key) ?? null,
    writeDeviceLocalStorageString: async (key: string, value: string) => { boundaries.localValues.set(key, value); },
    removeDeviceLocalStorageString: async (key: string) => { boundaries.localValues.delete(key); },
}));

vi.mock('@/sync/domains/ephemeralRunner/package/runnerArtifactAcquisitionSink', () => ({
    createRunnerArtifactAcquisitionSink: async (input: Readonly<{ sizeBytes: number }>) => {
        const uri = `memory://runner-stage/${++boundaries.sinkSequence}`;
        const chunks: Uint8Array[] = [];
        return {
            writeBytes: async (bytes: Uint8Array) => { chunks.push(bytes.slice()); },
            close: async () => {
                const output = new Uint8Array(input.sizeBytes);
                let offset = 0;
                for (const chunk of chunks) {
                    output.set(chunk, offset);
                    offset += chunk.byteLength;
                }
                boundaries.stagedBytes.set(uri, output);
            },
            cleanup: async () => { boundaries.stagedBytes.delete(uri); },
            source: async () => ({ kind: 'native' as const, uri, sizeBytes: input.sizeBytes }),
            custody: { kind: 'native_cache_file' as const, fileUri: uri },
        };
    },
    isRunnerArtifactAcquisitionCustodyHandle: (value: unknown) => Boolean(
        value && typeof value === 'object' && 'kind' in value,
    ),
    openRunnerArtifactAcquisitionCustody: async (custody: Readonly<{ fileUri: string }>) => ({
        kind: 'native' as const,
        uri: custody.fileUri,
    }),
    removeRunnerArtifactAcquisitionCustody: async (custody: Readonly<{ fileUri: string }>) => {
        boundaries.removedUris.push(custody.fileUri);
        boundaries.stagedBytes.delete(custody.fileUri);
    },
}));

vi.mock('@/components/sessions/reviews/comments/resolveReviewCommentDraftAnchorsForPrompt', () => ({
    resolveReviewCommentDraftAnchorsForPrompt: async (input: Readonly<{ drafts: readonly unknown[] }>) => input.drafts,
}));

vi.mock('@/sync/runtime/orchestration/serverScopedRpc/followUpSpawnedSession', () => ({
    followUpSpawnedSessionWithServerScope: async (input: unknown) => {
        boundaries.events.push('followup');
        boundaries.followUps.push(input);
    },
}));

import { encodeBase64 } from '@/encryption/base64';
import { stageRunnerAttachments } from '@/sync/domains/ephemeralRunner/stageRunnerAttachments';
import {
    acceptRunnerCreatorActivationBinding,
    readRunnerCreatorAttachmentUploadCustody,
    writePreparedRunnerCreatorLaunchCustody,
} from '@/sync/domains/ephemeralRunner/runnerCreatorLaunchCustody';
import { storage } from '@/sync/domains/state/storage';
import { buildWorkspaceCacheKey } from '@/sync/domains/workspaces/workspaceScope';
import {
    recoverMaterializedTemporaryComputerSessionForSession,
    settlePersistedMaterializedTemporaryComputerSession,
} from './settleMaterializedTemporaryComputerSession';

const scope = { serverId: 'srv_runner', accountId: 'creator' } as const;
const workspace = { serverId: scope.serverId, machineId: 'machine-a', rootPath: '/work/project' } as const;
const comment = {
    id: 'comment-frozen',
    filePath: 'src/example.ts',
    source: 'file' as const,
    anchor: { kind: 'fileLine' as const, startLine: 4, lineHash: 'lh1:1234567890abcdef' as const },
    snapshot: { selectedLines: ['const answer = 41;'], beforeContext: [], afterContext: [] },
    body: 'Use 42.',
    includeInPrompt: true,
    createdAt: 1,
};

function materializedProjection(input: Readonly<{
    activationId: string;
    preparedAuthoring: RunnerPreparedAuthoringV1;
}>): RunnerActivationProjectionV1 {
    const activationKey = tweetnacl.sign.keyPair();
    const installationKey = tweetnacl.sign.keyPair();
    const runnerBox = tweetnacl.box.keyPair();
    const signature = encodeBase64(new Uint8Array(64), 'base64url');
    const launchManifestCommitment = encodeBase64(new Uint8Array(32).fill(7), 'base64url');
    const binding = {
        activationId: input.activationId,
        homeServerIdentityId: scope.serverId,
        creatorAccountId: scope.accountId,
        creatorTokenEpoch: 1,
        activationExpiresAt: null,
        workspace: { kind: 'choose_on_endpoint' as const },
        sessionId: 'session-a',
        machineId: workspace.machineId,
        activationSigningPublicKey: encodeBase64(activationKey.publicKey, 'base64url'),
        authoringCommitment: computeRunnerAuthoringCommitmentV1(input.preparedAuthoring),
        artifact: {
            product: 'happier-runner' as const,
            version: '0.3.0',
            target: 'linux-x64' as const,
            sha256: 'a'.repeat(64),
        },
        endpointFactsRecipient: { mode: 'plain' as const, creatorAccountId: scope.accountId },
    };
    const claimPayload = {
        v: 1 as const,
        purpose: 'happier.ephemeral-session-runner.claim' as const,
        binding,
        runnerBoxPublicKey: encodeBase64(runnerBox.publicKey, 'base64url'),
        installation: {
            installationId: 'runner-installation',
            publicKey: encodeBase64(installationKey.publicKey, 'base64url'),
            proof: { version: 1 as const, algorithm: 'ed25519' as const, signature },
        },
        protocolEpoch: 1 as const,
    };
    const claim = { payload: claimPayload, signature };
    const credentialSelectionBinding = {
        v: 1 as const,
        resourceId: 'resource-a',
        brokerMachineId: 'broker-machine-a',
        revision: 1,
        application: {
            agentTargetKey: 'agent:happier.codex/codex',
            implementationIdentity: { pluginId: 'happier.provider.openai', localId: 'openai' },
            endpointTemplateId: 'responses',
            protocol: 'openai-responses' as const,
        },
        sourceRevision: 'source-a',
    };
    const review = {
        sealedLaunchManifest: 'sealed-launch-manifest',
        authoringCommitment: binding.authoringCommitment,
        launchManifestCommitment,
        endpointFactsProof: { activationSignature: signature, installationSignature: signature },
        agentTargetKey: 'agent:happier.codex/codex',
        machineContentKeyBinding: null,
        credentialSelectionBinding,
        displayFacts: {
            v: 1 as const,
            homeId: scope.serverId,
            homeName: 'Runner Home',
            requesterId: scope.accountId,
            requesterName: 'Creator',
            teamId: 'team-a',
            teamName: 'Team',
        },
    };
    const brokerReadinessRequest = {
        v: 1 as const,
        kind: 'provider_broker_readiness' as const,
        homeServerIdentityId: scope.serverId,
        activationId: input.activationId,
        launchManifestCommitment,
        resourceId: credentialSelectionBinding.resourceId,
        agentTargetKey: review.agentTargetKey,
        modelId: 'gpt-5',
        protocol: 'openai-responses' as const,
        initiator: { installationId: 'runner-installation', endpointId: 'a'.repeat(64) },
        target: { machineId: credentialSelectionBinding.brokerMachineId, endpointId: 'b'.repeat(64) },
        activationSignature: signature,
        installationSignature: signature,
    };
    return {
        ...binding,
        draftId: 'draft-a',
        state: 'materialized',
        closeReason: null,
        progressPhase: null,
        claim,
        endpointFacts: null,
        review,
        consent: {
            payload: {
                v: 1,
                purpose: 'happier.ephemeral-session-runner.consent',
                allow: true,
                claim: claimPayload,
                launchManifestCommitment,
            },
            activationSignature: signature,
            installationSignature: signature,
        },
        readiness: {
            payload: {
                v: 1,
                purpose: 'happier.ephemeral-session-runner.readiness',
                claim: claimPayload,
                launchManifestCommitment,
                installation: {
                    agentTarget: { kind: 'agent', identity: { pluginId: 'happier.codex', localId: 'codex' } },
                    managedInstallationId: 'managed-a',
                    executablePath: '/runner/codex',
                    authoritativeVersion: null,
                },
                credentialSelectionBinding,
                brokerReadinessRequest,
            },
            activationSignature: signature,
            installationSignature: signature,
        },
        materialization: { sessionId: binding.sessionId, machineId: binding.machineId },
    };
}

describe('materialized Runner attachment recovery integration', () => {
    beforeEach(() => {
        boundaries.localValues.clear();
        boundaries.stagedBytes.clear();
        boundaries.removedUris.length = 0;
        boundaries.sinkSequence = 0;
        boundaries.followUps.length = 0;
        boundaries.events.length = 0;
        storage.getState().clearWorkspaceReviewCommentDrafts(buildWorkspaceCacheKey(workspace));
    });

    it('resumes verified files after remount and admits the frozen first prompt only after every file matches', async () => {
        const staged = await stageRunnerAttachments([
            {
                id: 'file-one',
                source: { kind: 'memory', name: 'one.txt', mimeType: 'text/plain', bytes: new Uint8Array([1, 2, 3]) },
                status: 'pending',
            },
            {
                id: 'file-empty',
                source: { kind: 'memory', name: 'empty.txt', mimeType: 'text/plain', bytes: new Uint8Array() },
                status: 'pending',
            },
        ], { maxFileBytes: 1024 });
        const preparedAuthoring: RunnerPreparedAuthoringV1 = {
            v: 1,
            actionsSettings: { v: 1, actions: {} },
            mcpMaterial: null,
            agentPluginDistribution: null,
            authoring: {
                targetType: 'new_session',
                executionTarget: { kind: 'temporary_computer', serverId: scope.serverId, artifactTarget: 'linux-x64', workspace: { kind: 'choose_on_endpoint' } },
                agentTarget: { kind: 'agent', identity: { pluginId: 'happier.codex', localId: 'codex' } },
                permissionMode: 'default',
                modelSelection: null,
                transcriptStorage: 'persisted',
                profileId: null,
                environmentVariables: null,
                mcpSelection: { v: 1, managedServersEnabled: true, forceIncludeServerIds: [], forceExcludeServerIds: [] },
                connectedServices: null,
                checkoutCreationDraft: null,
                resumeSessionId: null,
                terminal: null,
                windowsRemoteSessionLaunchMode: null,
                windowsRemoteSessionConsole: null,
                windowsTerminalWindowName: null,
                acpSessionModeId: null,
                sessionConfigOptionOverrides: null,
                access: null,
                primaryTeamId: null,
                organizationPlacement: { folderId: null, tagIds: [] },
            },
            composer: {
                text: 'Inspect @issue-42',
                references: [{ kind: 'acme.issue', ref: 'issue:42', token: '@issue-42', label: 'Issue #42', start: 8, end: 17 }],
                attachments: [],
            },
            reviewComments: { workspace, comments: [comment] },
            files: [...staged.reviewedFiles],
            attachmentDestination: {
                uploadLocation: 'workspace',
                workspaceRelativeDir: '.happier/uploads',
                vcsIgnoreStrategy: 'git_info_exclude',
                vcsIgnoreWritesEnabled: true,
            },
        };
        const activationId = '00000000-0000-4000-8000-000000000091';
        const projection = materializedProjection({ activationId, preparedAuthoring });
        await writePreparedRunnerCreatorLaunchCustody({
            scope,
            activationId,
            preparedAuthoring,
            attachmentUpload: {
                attachmentMessageLocalId: 'attachment-message-a',
                firstTurnLocalId: 'first-turn-a',
                maxFileBytes: 1024,
                files: staged.custodyFiles,
            },
        });
        await acceptRunnerCreatorActivationBinding(scope, projection);
        const workspaceCacheKey = buildWorkspaceCacheKey(workspace);
        storage.getState().upsertWorkspaceReviewCommentDraft(workspaceCacheKey, comment);

        const uploadCounts = new Map<string, number>();
        let failEmptyOnce = true;
        const uploadFile: NonNullable<Parameters<typeof settlePersistedMaterializedTemporaryComputerSession>[0]['uploadFile']> = async ({ file }) => {
            const name = file.kind === 'web' ? file.file.name : file.name;
            const uri = file.kind === 'native' ? file.uri : null;
            const bytes = uri ? boundaries.stagedBytes.get(uri) : null;
            if (!bytes) throw new Error('staged bytes unavailable');
            uploadCounts.set(name, (uploadCounts.get(name) ?? 0) + 1);
            boundaries.events.push(`upload:${name}:${bytes.byteLength}`);
            if (name === 'empty.txt' && failEmptyOnce) {
                failEmptyOnce = false;
                return { success: false, error: 'transfer interrupted' };
            }
            const reviewed = staged.reviewedFiles.find((file) => file.name === name)!;
            return {
                success: true,
                path: `.happier/uploads/${name}`,
                sizeBytes: bytes.byteLength,
                sha256: reviewed.sha256,
            };
        };
        const present = async () => { boundaries.events.push('present'); };

        await expect(settlePersistedMaterializedTemporaryComputerSession({
            scope,
            draftId: 'draft-a',
            activationId,
            launchUserAttemptId: null,
            sessionId: 'session-a',
            projection,
            present,
            uploadFile,
        })).rejects.toMatchObject({ code: 'runner_attachment_upload_failed' });

        expect(boundaries.events).toEqual(['present', 'upload:one.txt:3', 'upload:empty.txt:0']);
        expect(boundaries.followUps).toHaveLength(0);
        expect(storage.getState().reviewCommentsDraftsByWorkspaceCacheKey[workspaceCacheKey]).toEqual([comment]);
        await expect(readRunnerCreatorAttachmentUploadCustody(scope, activationId)).resolves.toMatchObject({
            resumedUploads: [{ id: 'file-one', path: '.happier/uploads/one.txt', sizeBytes: 3 }],
        });

        await expect(recoverMaterializedTemporaryComputerSessionForSession({
            scope,
            sessionId: 'session-a',
            candidates: [{ draftId: 'draft-a', activationId, launchUserAttemptId: null }],
            readActivation: async () => projection,
            settle: (input) => settlePersistedMaterializedTemporaryComputerSession({ ...input, present, uploadFile }),
        })).resolves.toBe('settled');

        expect(uploadCounts).toEqual(new Map([['one.txt', 1], ['empty.txt', 2]]));
        expect(boundaries.events).toEqual([
            'present',
            'upload:one.txt:3',
            'upload:empty.txt:0',
            'present',
            'upload:empty.txt:0',
            'followup',
        ]);
        expect(boundaries.followUps).toHaveLength(1);
        const followUp = boundaries.followUps[0] as Readonly<{
            initialMessageText: string;
            messageLocalId?: string;
            metaOverrides?: Record<string, unknown>;
        }>;
        expect(followUp.messageLocalId).toBe('first-turn-a');
        expect(followUp.initialMessageText).toContain('.happier/uploads/one.txt');
        expect(followUp.initialMessageText).toContain('.happier/uploads/empty.txt');
        expect(followUp.initialMessageText.match(/\[attachments\]/gu)).toHaveLength(1);
        expect(followUp.metaOverrides).toMatchObject({
            happier: {
                kind: 'review_comments.v1',
                payload: { sessionId: 'session-a', comments: [{ id: comment.id, body: comment.body }] },
            },
        });
        expect(readHappierStructuredInputV1FromMeta(followUp.metaOverrides)?.mentions)
            .toEqual([expect.objectContaining({ kind: 'acme.issue', ref: 'issue:42' })]);
        expect(storage.getState().reviewCommentsDraftsByWorkspaceCacheKey[workspaceCacheKey]).toBeUndefined();
        await expect(readRunnerCreatorAttachmentUploadCustody(scope, activationId))
            .rejects.toMatchObject({ code: 'runner_creator_launch_custody_unavailable' });
        expect(boundaries.removedUris).toHaveLength(2);
        expect(boundaries.stagedBytes.size).toBe(0);
    });
});
