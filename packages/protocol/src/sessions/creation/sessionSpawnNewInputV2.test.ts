import { describe, expect, it } from 'vitest';

import {
  SessionAuthoringCheckoutCreationDraftV1Schema as canonicalCheckoutCreationDraftSchema,
} from '../authoring/creationFieldsV1.js';
import * as sessionSpawnInput from './sessionSpawnNewInputV2.js';

const { SessionSpawnNewInputV2Schema } = sessionSpawnInput;

const input = {
  executionTarget: { serverId: 'server-1', machineId: 'machine-1' },
  directory: '/workspace/project',
  agentTarget: {
    kind: 'agent',
    identity: { pluginId: 'happier.agent.codex', localId: 'codex' },
  },
} as const;

describe('SessionSpawnNewInputV2Schema', () => {
  it('accepts a Team-resource Connected Service binding at the Machine spawn boundary', () => {
    expect(SessionSpawnNewInputV2Schema.parse({
      ...input,
      connectedServices: {
        v: 2,
        bindingsByServiceId: {
          'happier.connected-accounts.test/service': {
            source: 'team_resource',
            deliveryMode: 'brokered',
            resourceId: 'resource-1',
          },
        },
      },
    }).connectedServices).toMatchObject({ v: 2 });
  });

  it('carries explicit Team context independently of an empty access draft', () => {
    const parsed = SessionSpawnNewInputV2Schema.parse({
      ...input, primaryTeamId: 'team', initialAccess: { grants: [] },
    });
    expect(parsed.primaryTeamId).toBe('team');
    expect(parsed.initialAccess).toEqual({ grants: [] });
    expect(SessionSpawnNewInputV2Schema.safeParse({ ...input, primaryTeamId: '' }).success).toBe(false);
  });
  it('carries every distinct Team credential slot atomically while preserving omission compatibility', () => {
    const providerBinding = {
      v: 1,
      slot: { kind: 'provider_model' },
      resourceId: 'resource-1',
      expectedResourceRevision: 0,
      deliveryMode: 'brokered',
    } as const;
    const purposeBinding = {
      v: 1,
      slot: {
        kind: 'connected_service_purpose',
        purpose: {
          consumer: { pluginId: 'happier.agent.codex', localId: 'codex' },
          purpose: 'repository_api',
        },
      },
      resourceId: 'resource-2',
      expectedResourceRevision: 3,
      deliveryMode: 'direct',
    } as const;
    const teamCredentialBindings = [providerBinding, purposeBinding];
    expect(SessionSpawnNewInputV2Schema.parse({ ...input, teamCredentialBindings }).teamCredentialBindings)
      .toEqual(teamCredentialBindings);
    expect(SessionSpawnNewInputV2Schema.parse(input)).not.toHaveProperty('teamCredentialBindings');
    expect(SessionSpawnNewInputV2Schema.safeParse({
      ...input,
      teamCredentialBindings: [purposeBinding, purposeBinding],
    }).success).toBe(false);
    expect(SessionSpawnNewInputV2Schema.safeParse({
      ...input,
      teamCredentialBindings: [{ ...providerBinding, unexpected: true }],
    }).success)
      .toBe(false);
  });
  it('preserves strict subject-keyed initial access through ordinary and browser-safe spawn', () => {
    const initialAccess = { grants: [
      { subject: { kind: 'account', accountId: 'reader' }, accessLevel: 'view', canApprovePermissions: false },
      { subject: { kind: 'team', teamId: 'team' }, accessLevel: 'edit', canApprovePermissions: true },
      { subject: { kind: 'group', teamId: 'team', groupId: 'group' }, accessLevel: 'admin', canApprovePermissions: false },
    ] };
    expect(SessionSpawnNewInputV2Schema.parse({ ...input, initialAccess }).initialAccess).toEqual(initialAccess);
    expect(sessionSpawnInput.SessionServerStartSpawnDraftV1Schema.parse({ ...input, initialAccess }).initialAccess)
      .toEqual(initialAccess);
    expect(SessionSpawnNewInputV2Schema.safeParse({
      ...input, initialAccess: { grants: [...initialAccess.grants, initialAccess.grants[0]] },
    }).success).toBe(false);
    expect(SessionSpawnNewInputV2Schema.safeParse({
      ...input, initialAccess: { grants: [{ ...initialAccess.grants[1], requiredByTeamPolicy: true }] },
    }).success).toBe(false);
    expect(SessionSpawnNewInputV2Schema.safeParse({
      ...input,
      initialAccess: {
        grants: [{
          ...initialAccess.grants[0],
          accountEnvelopeInput: { v: 1, encryptedDataKey: Buffer.alloc(105).toString('base64') },
        }],
      },
    }).success).toBe(false);
    expect(SessionSpawnNewInputV2Schema.safeParse({
      ...input, initialAccess: { grants: [], responsibleAccountId: 'reader' },
    }).success).toBe(false);
  });

  it('accepts only the strict informational placement origin', () => {
    const placementOrigin = {
      kind: 'machine_pool',
      poolId: '11111111-1111-4111-8111-111111111111',
    } as const;
    expect(SessionSpawnNewInputV2Schema.parse({ ...input, placementOrigin }).placementOrigin)
      .toEqual(placementOrigin);
    expect(SessionSpawnNewInputV2Schema.safeParse({
      ...input,
      placementOrigin: { ...placementOrigin, name: 'Private Pool' },
    }).success).toBe(false);
  });

  it('admits one structured initial input atomically and rejects the retired text-only field', () => {
    const initialInput = {
      text: 'Review the selected pull request.',
      attachments: [{
        attachmentLocalId: 'entry',
        value: {
          key: 'github:pull:42',
          value: { sourceId: 'github', entryId: '42' },
          presentation: { label: 'PR #42' },
        },
      }],
    } as const;

    expect(SessionSpawnNewInputV2Schema.parse({ ...input, initialInput }).initialInput)
      .toEqual(initialInput);
    expect(SessionSpawnNewInputV2Schema.safeParse({
      ...input,
      initialMessage: initialInput.text,
    }).success).toBe(false);
    expect(SessionSpawnNewInputV2Schema.safeParse({
      ...input,
      initialInput: { text: '' },
    }).success).toBe(false);
    expect(SessionSpawnNewInputV2Schema.safeParse({
      ...input,
      initialInput: { text: '', attachments: initialInput.attachments },
    }).success).toBe(true);
    expect(SessionSpawnNewInputV2Schema.safeParse({
      ...input,
      initialInput: { attachments: initialInput.attachments },
    }).success).toBe(true);
  });

  it('publishes the one bounded checkout authoring draft used by spawn', () => {
    expect('SessionAuthoringCheckoutCreationDraftV1Schema' in sessionSpawnInput).toBe(true);
    expect(sessionSpawnInput.SessionAuthoringCheckoutCreationDraftV1Schema)
      .toBe(canonicalCheckoutCreationDraftSchema);

    const checkoutCreationDraft = {
      kind: 'git_worktree',
      displayName: 'feature/session-create',
      baseRef: 'main',
      branchMode: 'new',
    } as const;
    expect(SessionSpawnNewInputV2Schema.parse({
      ...input,
      checkoutCreationDraft,
    }).checkoutCreationDraft).toEqual(checkoutCreationDraft);
    expect(sessionSpawnInput.SessionAuthoringCheckoutCreationDraftV1Schema.safeParse({
      ...checkoutCreationDraft,
      unexpected: true,
    }).success).toBe(false);
  });

  it('carries raw launch environment on the direct-to-daemon V2 input but never into the server-start draft', () => {
    const environmentVariables = { TOKEN: 'secret-value' } as const;
    expect(SessionSpawnNewInputV2Schema.parse({
      ...input,
      environmentVariables,
    }).environmentVariables).toEqual(environmentVariables);
    expect(sessionSpawnInput.SessionServerStartSpawnDraftV1Schema.safeParse({
      ...input,
      creationKey: undefined,
      initialInput: undefined,
      environmentVariables,
    }).success).toBe(false);
    expect(SessionSpawnNewInputV2Schema.safeParse({
      ...input,
      environmentVariables: { '': 'unnamed' },
    }).success).toBe(false);
  });

  it('accepts a value-free one-launch Saved Secret reference overlay', () => {
    const secretReferenceOverlay = {
      v: 1,
      bindings: {
        API_KEY: {
          ref: 'happier:shared-secret:v1:resource_1',
          revision: 3,
        },
      },
    } as const;
    expect(SessionSpawnNewInputV2Schema.parse({
      ...input,
      profileId: 'profile-1',
      secretReferenceOverlay,
    }).secretReferenceOverlay).toEqual(secretReferenceOverlay);
    expect(SessionSpawnNewInputV2Schema.safeParse({
      ...input,
      profileId: 'profile-1',
      secretReferenceOverlay: {
        v: 1,
        bindings: { API_KEY: { value: 'plaintext-is-not-a-reference' } },
      },
    }).success).toBe(false);
    expect(SessionSpawnNewInputV2Schema.safeParse({
      ...input,
      profileId: 'profile-1',
      secretReferenceOverlay: {
        v: 1,
        bindings: { API_KEY: { ref: 'happier:shared-secret:v1:resource_1' } },
      },
    }).success).toBe(false);
  });

  it('accepts only canonical permission intents at the public V2 boundary', () => {
    for (const permissionMode of ['default', 'read-only', 'safe-yolo', 'yolo', 'plan']) {
      expect(SessionSpawnNewInputV2Schema.safeParse({
        ...input,
        permissionMode,
      }).success, permissionMode).toBe(true);
    }

    expect(SessionSpawnNewInputV2Schema.safeParse({
      ...input,
      permissionMode: 'read_only',
    }).success).toBe(false);
    expect(SessionSpawnNewInputV2Schema.safeParse({
      ...input,
      permissionMode: 'surprise-me',
    }).success).toBe(false);
  });

  it('rejects opaque terminal and checkout fields at the public Session-create ingress', () => {
    expect(SessionSpawnNewInputV2Schema.parse(input)).toEqual(input);

    expect(SessionSpawnNewInputV2Schema.safeParse({
      ...input,
      terminal: {
        mode: 'tmux',
        unrecognizedTerminalSecret: 'must-not-persist',
      },
    }).success).toBe(false);
    expect(SessionSpawnNewInputV2Schema.safeParse({
      ...input,
      terminal: {
        mode: 'tmux',
        tmux: {
          sessionName: 'happier',
          unrecognizedTmuxSecret: 'must-not-persist',
        },
      },
    }).success).toBe(false);
    // `target` belongs to post-spawn terminal attachment metadata. It used to
    // survive authoring passthrough, then be stripped by the daemon's spawn
    // contract without affecting a new Session.
    expect(SessionSpawnNewInputV2Schema.safeParse({
      ...input,
      terminal: {
        mode: 'tmux',
        tmux: {
          sessionName: 'happier',
          target: 'existing-session:window',
        },
      },
    }).success).toBe(false);
    expect(SessionSpawnNewInputV2Schema.safeParse({
      ...input,
      checkoutCreationDraft: {
        kind: 'git_worktree',
        displayName: 'feature/session-create',
        baseRef: 'main',
        unrecognizedCheckoutSecret: 'must-not-persist',
      },
    }).success).toBe(false);
  });
});
