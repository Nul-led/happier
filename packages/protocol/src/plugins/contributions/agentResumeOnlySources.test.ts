import { describe, expect, it } from 'vitest';

import {
  AGENT_RESUME_ONLY_SOURCE_CONTRACT_ISSUE,
  declaresHostSynthesizedAgentResumeOnlyExternalSources,
  findAgentResumeOnlyExternalSourceContractIssue,
} from './agentResumeOnlySources.js';

const source = (extra: Readonly<Record<string, unknown>> = {}) => ({
  sourceKind: 'acpSessions',
  schema: { fields: [{ name: 'kind', kind: 'literal', value: 'acpSessions' }] },
  key: { segments: [{ kind: 'literal', value: 'acpSessions' }] },
  ...extra,
});

const contribution = (overrides: Readonly<Record<string, unknown>> = {}) => ({
  id: 'assistant',
  runtime: { kind: 'acp' },
  primary: 'sessions',
  capabilities: {
    surfaces: ['externalSessions'],
    sessions: { open: ['create', 'resume'], delivery: ['newTurn'], cancel: true },
  },
  surfaces: { externalSession: { sources: [source({ resumeOnly: true })] } },
  ...overrides,
});

describe('agent resume-only External Sessions source contract', () => {
  it('accepts a resume-only source only for an ACP Session-primary Agent that opens resume', () => {
    expect(findAgentResumeOnlyExternalSourceContractIssue(contribution())).toBeNull();
    // No resume-only source at all: the contract does not apply.
    expect(findAgentResumeOnlyExternalSourceContractIssue(contribution({
      surfaces: { externalSession: { sources: [source()] } },
    }))).toBeNull();
    for (const invalid of [
      contribution({ runtime: { kind: 'custom' } }),
      contribution({ primary: 'executionRuns' }),
      contribution({
        capabilities: {
          surfaces: ['externalSessions'],
          sessions: { open: ['create'], delivery: ['newTurn'], cancel: true },
        },
      }),
    ]) {
      expect(findAgentResumeOnlyExternalSourceContractIssue(invalid))
        .toBe(AGENT_RESUME_ONLY_SOURCE_CONTRACT_ISSUE);
    }
  });

  it('reports host synthesis only when every declared source is a valid resume-only source', () => {
    // This is the one rule the SDK authoring assertion, the registration rights
    // the host activation enforces, and the host's declarative ACP runtime
    // synthesis all read. If it drifts, a plugin is either asked for a
    // contribution it is forbidden to write, or the host advertises resume
    // candidates no runtime can load.
    expect(declaresHostSynthesizedAgentResumeOnlyExternalSources(contribution())).toBe(true);

    // One non-resume-only source is one source the host cannot produce.
    expect(declaresHostSynthesizedAgentResumeOnlyExternalSources(contribution({
      surfaces: { externalSession: { sources: [source({ resumeOnly: true }), source()] } },
    }))).toBe(false);
    expect(declaresHostSynthesizedAgentResumeOnlyExternalSources(contribution({
      surfaces: { externalSession: { sources: [source()] } },
    }))).toBe(false);

    // No sources, no descriptor, and a non-Agent value are all "not synthesized".
    expect(declaresHostSynthesizedAgentResumeOnlyExternalSources(contribution({
      surfaces: { externalSession: { sources: [] } },
    }))).toBe(false);
    expect(declaresHostSynthesizedAgentResumeOnlyExternalSources(contribution({ surfaces: undefined })))
      .toBe(false);
    expect(declaresHostSynthesizedAgentResumeOnlyExternalSources(undefined)).toBe(false);

    // Bypassed installed data that violates the contract must never reach
    // synthesis, even though every source says `resumeOnly`.
    expect(declaresHostSynthesizedAgentResumeOnlyExternalSources(contribution({
      capabilities: {
        surfaces: ['externalSessions'],
        sessions: { open: ['create'], delivery: ['newTurn'], cancel: true },
      },
    }))).toBe(false);
    expect(declaresHostSynthesizedAgentResumeOnlyExternalSources(contribution({
      runtime: { kind: 'custom' },
    }))).toBe(false);
  });
});
