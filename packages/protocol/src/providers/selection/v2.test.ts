import { describe, expect, it } from 'vitest';

import {
  SessionModelSelectionV2Schema,
  projectSessionModelSelectionV2ToV1,
  sessionModelSelectionV2TeamBindingIntent,
} from './v2.js';

describe('SessionModelSelectionV2', () => {
  it('represents Team credential resources without fabricating a Provider Connection', () => {
    const selection = SessionModelSelectionV2Schema.parse({
      v: 2,
      ref: {
        source: 'team_resource', resourceId: 'resource-1', teamId: 'team-1',
        expectedResourceRevision: 7, deliveryMode: 'direct', agentTargetKey: 'backend:claude', modelId: 'claude-sonnet',
      },
      updatedAt: 123,
    });

    expect(selection.ref).toEqual({
      source: 'team_resource',
      resourceId: 'resource-1',
      teamId: 'team-1',
      expectedResourceRevision: 7,
      deliveryMode: 'direct',
      agentTargetKey: 'backend:claude',
      modelId: 'claude-sonnet',
    });
    expect(projectSessionModelSelectionV2ToV1(selection)).toBeNull();
    expect(sessionModelSelectionV2TeamBindingIntent(selection)).toEqual({
      v: 1,
      slot: { kind: 'provider_model' },
      resourceId: 'resource-1',
      expectedResourceRevision: 7,
      deliveryMode: 'direct',
      teamId: 'team-1',
    });
  });

  it('projects native and Account Provider Connection selections to the released V1 shape', () => {
    expect(projectSessionModelSelectionV2ToV1(SessionModelSelectionV2Schema.parse({
      v: 2,
      ref: { source: 'native', agentTargetKey: 'claude', modelId: 'opus' },
      updatedAt: 123,
    }))).toEqual({
      v: 1,
      ref: { agentTargetKey: 'claude', providerConnectionId: null, modelId: 'opus' },
      updatedAt: 123,
    });
    expect(projectSessionModelSelectionV2ToV1(SessionModelSelectionV2Schema.parse({
      v: 2,
      ref: {
        source: 'account_provider_connection',
        agentTargetKey: 'claude',
        providerConnectionId: 'connection-1',
        modelId: 'opus',
      },
      updatedAt: 123,
    }))).toEqual({
      v: 1,
      ref: {
        agentTargetKey: 'claude',
        providerConnectionId: 'connection-1',
        modelId: 'opus',
      },
      updatedAt: 123,
    });
  });

  it('requires an exact catalog revision when deriving a Team binding', () => {
    const selection = SessionModelSelectionV2Schema.parse({
      v: 2,
      ref: {
        source: 'team_resource', resourceId: 'resource-1', teamId: 'team-1',
        expectedResourceRevision: 7, deliveryMode: 'brokered', agentTargetKey: 'backend:claude', modelId: 'opus',
      },
      updatedAt: 123,
    });
    expect(sessionModelSelectionV2TeamBindingIntent(selection).expectedResourceRevision).toBe(7);
    expect(SessionModelSelectionV2Schema.safeParse({
      v: 2,
      ref: { source: 'native', agentTargetKey: 'claude', modelId: 'opus' },
      resourceRevision: 1,
      updatedAt: 123,
    }).success).toBe(false);
  });

  it('turns a non-Team selection into an explicit binding clear', () => {
    expect(sessionModelSelectionV2TeamBindingIntent(SessionModelSelectionV2Schema.parse({
      v: 2,
      ref: { source: 'native', agentTargetKey: 'agent:codex', modelId: 'gpt-5' },
      updatedAt: 1,
    }))).toEqual({ v: 1, slot: { kind: 'provider_model' }, resourceId: null });
  });
});
