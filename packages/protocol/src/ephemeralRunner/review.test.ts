import { describe, expect, it } from 'vitest';

import { encodeBase64 } from '../crypto/base64.js';
import { RunnerActivationReviewV1Schema } from './review.js';

const reviewedAgentTargetKey = 'agent:happier.agent.codex/codex';
const application = {
  agentTargetKey: reviewedAgentTargetKey,
  implementationIdentity: { pluginId: 'happier.provider.openai', localId: 'openai' },
  endpointTemplateId: 'responses', protocol: 'openai-responses',
};

function reviewFixture() {
  return {
    sealedLaunchManifest: 'sealed-launch-manifest',
    authoringCommitment: encodeBase64(new Uint8Array(32).fill(6), 'base64url'),
    launchManifestCommitment: encodeBase64(new Uint8Array(32).fill(7), 'base64url'),
    endpointFactsProof: {
      activationSignature: encodeBase64(new Uint8Array(64).fill(8), 'base64url'),
      installationSignature: encodeBase64(new Uint8Array(64).fill(9), 'base64url'),
    },
    agentTargetKey: reviewedAgentTargetKey,
    machineContentKeyBinding: null,
    credentialSelectionBinding: {
      v: 1,
      resourceId: 'resource-a',
      brokerMachineId: 'broker-a',
      revision: 1,
      application,
      sourceRevision: 'source-revision-1',
    },
    displayFacts: {
      v: 1,
      homeId: 'home-a',
      homeName: 'Acme Home',
      requesterId: 'account-a',
      requesterName: 'Alice Example',
      teamId: 'team-a',
      teamName: 'Platform 🌍',
    },
  };
}

describe('Runner activation review', () => {
  it('carries the exact first authoring commitment in the closed review sidecar', () => {
    expect(RunnerActivationReviewV1Schema.safeParse(reviewFixture()).success).toBe(true);
    const { authoringCommitment: _omitted, ...withoutAuthoringCommitment } = reviewFixture();
    expect(RunnerActivationReviewV1Schema.safeParse(withoutAuthoringCommitment).success).toBe(false);
  });

  it('requires one exact qualified Agent target key in the authenticated content-free sidecar', () => {
    expect(RunnerActivationReviewV1Schema.safeParse(reviewFixture()).success).toBe(true);
    const { agentTargetKey: _omitted, ...withoutAgentTargetKey } = reviewFixture();
    expect(RunnerActivationReviewV1Schema.safeParse(withoutAgentTargetKey).success).toBe(false);
    expect(RunnerActivationReviewV1Schema.safeParse({
      ...reviewFixture(),
      agentTargetKey: 'codex',
    }).success).toBe(false);
  });

  it('seals exact application and source currentness without model or endpoint content', () => {
    const parsed = RunnerActivationReviewV1Schema.parse(reviewFixture());
    expect(parsed.credentialSelectionBinding.application).toEqual(application);
    expect(parsed.credentialSelectionBinding.sourceRevision).toBe('source-revision-1');
    expect(parsed.credentialSelectionBinding).not.toHaveProperty('modelId');
    expect(parsed.credentialSelectionBinding).not.toHaveProperty('url');
  });

  it('requires an exact nullable Machine content-key binding sidecar', () => {
    expect(RunnerActivationReviewV1Schema.safeParse(reviewFixture()).success).toBe(true);
    const { machineContentKeyBinding: _omitted, ...withoutBinding } = reviewFixture();
    expect(RunnerActivationReviewV1Schema.safeParse(withoutBinding).success).toBe(false);
  });

  it('binds review publication to the exact dual-signed endpoint facts', () => {
    expect(RunnerActivationReviewV1Schema.safeParse(reviewFixture()).success).toBe(true);
    const { endpointFactsProof: _omitted, ...withoutEndpointFactsProof } = reviewFixture();
    expect(RunnerActivationReviewV1Schema.safeParse(withoutEndpointFactsProof).success).toBe(false);
    expect(RunnerActivationReviewV1Schema.safeParse({
      ...reviewFixture(),
      endpointFactsProof: {
        ...reviewFixture().endpointFactsProof,
        activationSignature: 'not-canonical-base64url',
      },
    }).success).toBe(false);
  });

  it('admits bounded Unicode verified labels and rejects unsafe or omitted display facts', () => {
    const unicodeName = '界🌍'.repeat(64);
    expect(RunnerActivationReviewV1Schema.safeParse({
      ...reviewFixture(),
      displayFacts: { ...reviewFixture().displayFacts, teamName: unicodeName },
    }).success).toBe(true);
    expect(RunnerActivationReviewV1Schema.safeParse({
      ...reviewFixture(),
      displayFacts: { ...reviewFixture().displayFacts, homeName: 'Acme\nHome' },
    }).success).toBe(false);
    const { displayFacts: _omitted, ...withoutDisplayFacts } = reviewFixture();
    expect(RunnerActivationReviewV1Schema.safeParse(withoutDisplayFacts).success).toBe(false);
  });
});
