import { describe, expect, it } from 'vitest';

import {
  createModelIntentMetadataCasCandidate,
  createModelIntentV2MetadataCasCandidate,
} from './metadataWriters.js';

const selection = {
  agentTargetKey: 'backend:codex',
  providerConnectionId: null,
  modelId: 'default',
} as const;
const teamRef = {
  source: 'team_resource' as const,
  resourceId: 'resource-1',
  teamId: 'team-1',
  expectedResourceRevision: 7,
  deliveryMode: 'brokered' as const,
  agentTargetKey: 'backend:codex',
  modelId: 'model-a',
};

describe('createModelIntentMetadataCasCandidate', () => {
  it('assigns owner order once and does not promote a stale retry over a newer intent', () => {
    const candidate = createModelIntentMetadataCasCandidate({
      selection,
      nowMs: () => 20,
    });
    const first = candidate.update({
      modelSelectionIntentV1: {
        v: 1,
        updatedAt: 10,
        selection: { ...selection, modelId: 'old' },
      },
    });
    expect(first.modelSelectionIntentV1).toMatchObject({
      updatedAt: 20,
      selection,
    });
    expect(candidate.readState()).toEqual({ accepted: true, updatedAt: 20 });

    const retry = candidate.update({
      modelSelectionIntentV1: {
        v: 1,
        updatedAt: 21,
        selection: { ...selection, modelId: 'newer' },
      },
    });
    expect(retry.modelSelectionIntentV1).toMatchObject({
      updatedAt: 21,
      selection: { modelId: 'newer' },
    });
    expect(candidate.readState()).toEqual({ accepted: false, updatedAt: 20 });
  });
});

describe('createModelIntentV2MetadataCasCandidate', () => {
  it('persists an exact Team resource selection without projecting a native Provider identity', () => {
    const candidate = createModelIntentV2MetadataCasCandidate({
      selection: {
        v: 2,
        updatedAt: 20,
        ref: teamRef,
      },
      nowMs: () => 20,
    });

    const next = candidate.update({
      modelSelectionIntentV1: { v: 1, updatedAt: 10, selection },
      modelOverrideV1: { v: 1, updatedAt: 10, modelId: 'default' },
    });

    expect(next).toMatchObject({
      modelSelectionIntentV2: {
        v: 2,
        updatedAt: 20,
        ref: teamRef,
      },
    });
    expect(next).not.toHaveProperty('modelSelectionIntentV1');
    expect(next).not.toHaveProperty('modelOverrideV1');
    expect(candidate.readState()).toEqual({ accepted: true, updatedAt: 20 });
  });

  it('does not let a lost-response retry overwrite a newer V2 intent', () => {
    const candidate = createModelIntentV2MetadataCasCandidate({
      selection: {
        v: 2,
        updatedAt: 20,
        ref: teamRef,
      },
      nowMs: () => 20,
    });
    candidate.update({});
    const retry = candidate.update({
      modelSelectionIntentV2: {
        v: 2,
        updatedAt: 21,
        ref: { ...teamRef, resourceId: 'resource-2', modelId: 'model-b' },
      },
    });

    expect(retry).toMatchObject({
      modelSelectionIntentV2: { updatedAt: 21, ref: { resourceId: 'resource-2' } },
    });
    expect(candidate.readState()).toEqual({ accepted: false, updatedAt: 20 });
  });
});
