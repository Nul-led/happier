import { z } from 'zod';
import { describe, expect, it } from 'vitest';

import {
  SESSION_DRAFT_ROUTE_LIST,
  SESSION_DRAFT_ROUTE_MUTATE,
  SESSION_DRAFT_ROUTE_READ,
  SESSION_DRAFT_SOCKET_EVENT,
  DraftFieldV1Schema,
  SessionDraftAddressV1Schema,
  SessionDraftChangeHintV1Schema,
  SessionDraftListRequestV1Schema,
  SessionDraftListResponseV1Schema,
  SessionDraftMutateRequestV1Schema,
  SessionDraftMutateResponseV1Schema,
  SessionDraftReadRequestV1Schema,
  SessionDraftReadResponseV1Schema,
  SessionDraftPrivatePayloadV1Schema,
  SessionDraftDocumentV1Schema,
} from './sessionDrafts.js';
import { SyncedSessionAuthoringFieldIdV1Schema } from '../sessions/authoring/index.js';
import {
  SESSION_DRAFT_V2_ROUTE_LIST,
  SESSION_DRAFT_V2_ROUTE_MUTATE,
  SESSION_DRAFT_V2_ROUTE_READ,
  SESSION_DRAFT_V2_SOCKET_EVENT,
  CanonicalSessionDraftAddressV2Schema,
  SessionDiscussionDraftDocumentV2Schema,
  SessionDraftAddressV2Schema,
  SessionDraftChangeHintV2Schema,
  SessionDraftListRequestV2Schema,
  SessionDraftMutateRequestV2Schema,
  SessionDraftPrivatePayloadV2Schema,
  SessionDraftStoredContentEnvelopeV2Schema,
  SessionDraftReadRequestV2Schema,
  canonicalSessionDraftAddressV2,
  isSessionDraftAddressV1,
  parseCanonicalSessionDraftAddressV2,
  projectNewSessionDraftDocumentToSupportedPredecessorV1,
  restoreSupportedPredecessorNewSessionDraftPayloadV2,
} from './sessionDraftsV2.js';

const mutationId = '00000000-0000-4000-8000-000000000001';
const titleMutationId = '00000000-0000-4000-8000-000000000002';

const field = <T>(value: T) => ({ mutationId, value });

function runDocument(runId: string) {
  return {
    v: 1 as const,
    composer: { text: field('hello'), mentions: field([]), attachments: field([]) },
    target: {
      kind: 'session' as const,
      routing: {
        recipient: field({ mode: 'manual', recipient: { kind: 'execution_run', runId } }),
        agentContinuation: field(null),
        executionRunDelivery: field(null),
      },
    },
    extensions: {},
  };
}

function discussionDocument(kind: 'discussion' | 'newDiscussion') {
  return {
    v: 2 as const,
    target: { kind },
    composer: { text: field('hi'), mentions: field([]), attachments: field([]) },
  };
}

describe('session draft V2 addresses', () => {
  it('accepts every V1 address plus the three Lane 05 kinds', () => {
    const addresses = [
      { kind: 'newSession', draftId: '00000000-0000-4000-8000-00000000000a' },
      { kind: 'session', sessionId: 'session-1' },
      { kind: 'run', sessionId: 'session-1', runId: 'run-1' },
      { kind: 'discussion', sessionId: 'session-1', discussionId: 'disc-1' },
      { kind: 'newDiscussion', sessionId: 'session-1' },
    ];
    for (const address of addresses) {
      expect(SessionDraftAddressV2Schema.safeParse(address).success).toBe(true);
    }
  });

  it('keeps V1 canonical strings byte-identical and adds encoded segments', () => {
    expect(canonicalSessionDraftAddressV2({ kind: 'session', sessionId: 'session-1' }))
      .toBe('session/session-1');
    expect(canonicalSessionDraftAddressV2({
      kind: 'newSession',
      draftId: '00000000-0000-4000-8000-00000000000a',
    })).toBe('new-session/00000000-0000-4000-8000-00000000000a');
    expect(canonicalSessionDraftAddressV2({ kind: 'run', sessionId: 's/1', runId: 'r 1' }))
      .toBe('session/s%2F1/run/r%201');
    expect(canonicalSessionDraftAddressV2({ kind: 'discussion', sessionId: 's1', discussionId: 'd1' }))
      .toBe('session/s1/discussion/d1');
    expect(canonicalSessionDraftAddressV2({ kind: 'newDiscussion', sessionId: 's1' }))
      .toBe('session/s1/new-discussion');
  });

  it('round-trips every canonical address and rejects non-canonical strings', () => {
    const addresses = [
      { kind: 'session', sessionId: 'a/b' },
      { kind: 'run', sessionId: 'a/b', runId: 'c d' },
      { kind: 'discussion', sessionId: 's1', discussionId: 'd1' },
      { kind: 'newDiscussion', sessionId: 's1' },
    ] as const;
    for (const address of addresses) {
      const canonical = canonicalSessionDraftAddressV2(address);
      expect(CanonicalSessionDraftAddressV2Schema.safeParse(canonical).success).toBe(true);
      expect(canonicalSessionDraftAddressV2(parseCanonicalSessionDraftAddressV2(canonical)!))
        .toBe(canonical);
    }
    expect(parseCanonicalSessionDraftAddressV2('session/s1/run/')).toBeNull();
    expect(parseCanonicalSessionDraftAddressV2('session/s1/unknown/x')).toBeNull();
    expect(CanonicalSessionDraftAddressV2Schema.safeParse('session/s%2f1').success).toBe(false);
  });

  it('never confuses a session id containing a segment separator with a run address', () => {
    const spoof = canonicalSessionDraftAddressV2({ kind: 'session', sessionId: 's1/run/r1' });
    expect(spoof).toBe('session/s1%2Frun%2Fr1');
    expect(parseCanonicalSessionDraftAddressV2(spoof)).toEqual({
      kind: 'session',
      sessionId: 's1/run/r1',
    });
  });

  it('keeps the new-discussion discriminator disjoint from any admitted discussion id', () => {
    const spoof = canonicalSessionDraftAddressV2({
      kind: 'discussion',
      sessionId: 's1',
      discussionId: 'new-discussion',
    });
    expect(spoof).toBe('session/s1/discussion/new-discussion');
    expect(parseCanonicalSessionDraftAddressV2('session/s1/new-discussion'))
      .toEqual({ kind: 'newDiscussion', sessionId: 's1' });
  });

  it('classifies V1 addresses for epoch-scoped readers', () => {
    expect(isSessionDraftAddressV1({ kind: 'session', sessionId: 's1' })).toBe(true);
    expect(isSessionDraftAddressV1({ kind: 'run', sessionId: 's1', runId: 'r1' })).toBe(false);
    expect(isSessionDraftAddressV1({ kind: 'newDiscussion', sessionId: 's1' })).toBe(false);
  });
});

describe('strict V1 isolation', () => {
  it('keeps every post-0.2 authoring field out of the released V1 document', () => {
    const currentOnlyFields = {
      executionTarget: { kind: 'machine', target: { serverId: 'home-a', machineId: 'machine-a' } },
      temporaryComputerActivationRef: null,
      access: null,
      primaryTeamId: 'team-a',
      organizationPlacement: { folderId: null, tagIds: [] },
      agentTarget: null,
      modelSelection: null,
      runtimeDescriptorV1: null,
    } as const;
    for (const [fieldId, value] of Object.entries(currentOnlyFields)) {
      expect(SessionDraftDocumentV1Schema.safeParse({
        v: 1,
        composer: { text: field(''), mentions: field([]), attachments: field([]) },
        target: { kind: 'newSession', authoring: { [fieldId]: field(value) } },
        extensions: {},
      }).success, fieldId).toBe(false);
    }
  });

  it('projects current V1-compatible writer output through every strict released response parser', () => {
    const address = { kind: 'newSession' as const, draftId: '00000000-0000-4000-8000-00000000000a' };
    const document = {
      v: 1 as const,
      composer: { text: field('hello'), mentions: field([]), attachments: field([]) },
      target: {
        kind: 'newSession' as const,
        authoring: {
          machineId: field('machine-a'),
          serverId: field('home-a'),
          directory: field('/workspace'),
        },
      },
      extensions: {},
    };
    const content = { t: 'plain' as const, v: { v: 1 as const, address, document } };
    const record = { address, revision: 1, content, createdAt: 1, updatedAt: 2 };

    expect(SessionDraftPrivatePayloadV1Schema.parse(content.v)).toEqual(content.v);
    expect(SessionDraftReadResponseV1Schema.parse({ status: 'present', record })).toEqual({ status: 'present', record });
    expect(SessionDraftListResponseV1Schema.parse({ items: [record] })).toEqual({ items: [record] });
    expect(SessionDraftMutateResponseV1Schema.parse({ status: 'updated', record })).toEqual({ status: 'updated', record });
    expect(SessionDraftMutateResponseV1Schema.parse({ status: 'conflict', current: record })).toEqual({ status: 'conflict', current: record });
  });

  it('cannot express a V2 address in any V1 request or hint', () => {
    const runAddress = { kind: 'run', sessionId: 's1', runId: 'r1' };
    expect(SessionDraftAddressV1Schema.safeParse(runAddress).success).toBe(false);
    expect(SessionDraftReadRequestV1Schema.safeParse({ address: runAddress }).success).toBe(false);
    expect(SessionDraftMutateRequestV1Schema.safeParse({
      address: runAddress,
      expectedRevision: 'absent',
      content: null,
    }).success).toBe(false);
    expect(SessionDraftListRequestV1Schema.safeParse({
      after: 'session/s1/run/r1',
    }).success).toBe(false);
    expect(SessionDraftListResponseV1Schema.safeParse({
      items: [],
      nextAfter: 'session/s1/run/r1',
    }).success).toBe(false);
  });

  it('does not admit a renamed requested-action sibling into the released V1 document', () => {
    const document = runDocument('r1');
    expect(SessionDraftDocumentV1Schema.safeParse({
      ...document,
      target: {
        kind: 'session',
        routing: {
          recipient: document.target.routing.recipient,
          agentContinuation: document.target.routing.agentContinuation,
          executionRunRequestedAction: field({ v: 1, kind: 'enqueue' }),
        },
      },
    }).success).toBe(false);
  });

  it('a released V1 hint/socket reader ignores a V2 hint instead of mis-parsing it', () => {
    const hint = SessionDraftChangeHintV2Schema.parse({
      v: 2,
      sessionDraftV2: true,
      address: { kind: 'run', sessionId: 's1', runId: 'r1' },
      revision: 3,
      status: 'present',
    });
    expect(SessionDraftChangeHintV1Schema.safeParse(hint).success).toBe(false);
    expect(SESSION_DRAFT_V2_SOCKET_EVENT).not.toBe(SESSION_DRAFT_SOCKET_EVENT);
    expect([
      SESSION_DRAFT_V2_ROUTE_READ,
      SESSION_DRAFT_V2_ROUTE_LIST,
      SESSION_DRAFT_V2_ROUTE_MUTATE,
    ]).toEqual([
      '/v2/account/session-drafts/read',
      '/v2/account/session-drafts/list',
      '/v2/account/session-drafts/mutate',
    ]);
    expect([SESSION_DRAFT_ROUTE_READ, SESSION_DRAFT_ROUTE_LIST, SESSION_DRAFT_ROUTE_MUTATE])
      .toEqual([
        '/v1/account/session-drafts/read',
        '/v1/account/session-drafts/list',
        '/v1/account/session-drafts/mutate',
      ]);
  });

  it('carries V1 addresses through V2 requests with the untouched V1 envelope', () => {
    const payload = {
      v: 1,
      address: { kind: 'session', sessionId: 's1' },
      document: runDocument('r1'),
    };
    expect(SessionDraftPrivatePayloadV1Schema.safeParse(payload).success).toBe(true);
    expect(SessionDraftPrivatePayloadV2Schema.safeParse(payload).success).toBe(true);
    expect(SessionDraftReadRequestV2Schema.safeParse({
      address: { kind: 'session', sessionId: 's1' },
    }).success).toBe(true);
    expect(SessionDraftListRequestV2Schema.safeParse({
      after: 'session/s1/run/r1',
      addressKinds: ['run', 'discussion'],
    }).success).toBe(true);
  });
});

describe('V2 private payload correspondence', () => {
  it('losslessly projects the moving 0.2 successor field map without widening released V1', () => {
    // Prospective predecessor basis: ../0.2@15bcaa176af8063f6fef4eac81567078e2f0b63b,
    // packages/protocol/src/drafts/sessionDrafts.ts. Its strict V1 document
    // preserves these five successor field ids as opaque DraftFieldV1 values.
    const predecessorSuccessorFieldId = z.enum([
      'executionTarget',
      'organizationPlacement',
      'agentTarget',
      'modelSelection',
      'runtimeDescriptorV1',
    ]);
    const predecessorDocumentSchema = z.object({
      v: z.literal(1),
      composer: SessionDraftDocumentV1Schema.shape.composer,
      target: z.object({
        kind: z.literal('newSession'),
        authoring: z.partialRecord(
          z.union([SyncedSessionAuthoringFieldIdV1Schema, predecessorSuccessorFieldId]),
          DraftFieldV1Schema,
        ),
      }).strict(),
      extensions: SessionDraftDocumentV1Schema.shape.extensions,
    }).strict();
    const address = { kind: 'newSession' as const, draftId: '00000000-0000-4000-8000-00000000000a' };
    const document = {
      v: 2 as const,
      composer: { text: field('hello'), mentions: field([]), attachments: field([]) },
      target: {
        kind: 'newSession' as const,
        authoring: {
          executionTarget: field({
            kind: 'machine',
            target: { serverId: 'home-a', machineId: 'machine-a' },
            selectionOrigin: { kind: 'machine_pool', poolId: '11111111-1111-4111-8111-111111111111' },
          }),
          organizationPlacement: field({ folderId: null, tagIds: ['tag-a'] }),
          agentTarget: field(null),
          modelSelection: field(null),
          runtimeDescriptorV1: field(null),
        },
      },
      extensions: { example: { retained: field({ bounded: true }) } },
    };

    const projected = projectNewSessionDraftDocumentToSupportedPredecessorV1(document);
    expect(projected).toEqual({
      ...document,
      v: 1,
      target: {
        ...document.target,
        authoring: {
          ...document.target.authoring,
          serverId: field('home-a'),
          machineId: field('machine-a'),
        },
      },
    });
    expect(predecessorDocumentSchema.parse(projected)).toEqual(projected);
    expect(SessionDraftDocumentV1Schema.safeParse(projected).success).toBe(false);
    expect(SessionDraftStoredContentEnvelopeV2Schema.safeParse({
      t: 'plain',
      v: { v: 1, address, document: projected },
    }).success).toBe(true);

    expect(restoreSupportedPredecessorNewSessionDraftPayloadV2({
      v: 1,
      address,
      document: {
        ...projected,
        target: {
          ...projected!.target,
          // A supported predecessor re-projects its own flat display fields
          // when the user edits the draft. They are not execution authority
          // and must not make the preserved successor selection unreadable.
          authoring: {
            ...projected!.target.authoring,
            serverId: { mutationId: '00000000-0000-4000-8000-000000000002', value: 'home-a' },
            machineId: { mutationId: '00000000-0000-4000-8000-000000000003', value: 'machine-b' },
          },
        },
      },
    })).toEqual({
      v: 2,
      address,
      document: {
        ...document,
        target: {
          ...document.target,
          authoring: {
            ...document.target.authoring,
            executionTarget: {
              mutationId: '00000000-0000-4000-8000-000000000003',
              value: { kind: 'machine', target: { serverId: 'home-a', machineId: 'machine-b' } },
            },
          },
        },
      },
    });
  });

  it('reconciles predecessor target mirrors without retaining stale Pool provenance', () => {
    const baseMutationId = '00000000-0000-4000-8000-000000000010';
    const serverMutationId = '00000000-0000-4000-8000-000000000011';
    const machineMutationId = '00000000-0000-4000-8000-000000000012';
    const address = { kind: 'newSession' as const, draftId: '00000000-0000-4000-8000-00000000000a' };
    const executionTarget = {
      mutationId: baseMutationId,
      value: {
        kind: 'machine' as const,
        target: { serverId: 'home-a', machineId: 'machine-a' },
        selectionOrigin: { kind: 'machine_pool' as const, poolId: '11111111-1111-4111-8111-111111111111' },
      },
    };
    const payload = (serverId: { mutationId: string; value: string | null } | undefined, machineId: { mutationId: string; value: string | null } | undefined) => ({
      v: 1 as const,
      address,
      document: {
        v: 1 as const,
        composer: { text: field('hello'), mentions: field([]), attachments: field([]) },
        target: { kind: 'newSession' as const, authoring: { executionTarget, ...(serverId ? { serverId } : {}), ...(machineId ? { machineId } : {}) } },
        extensions: {},
      },
    });

    const textOnlyEdit = payload(
      { mutationId: baseMutationId, value: 'home-a' },
      { mutationId: baseMutationId, value: 'machine-a' },
    );
    textOnlyEdit.document.composer.text = {
      mutationId: '00000000-0000-4000-8000-000000000013',
      value: 'edited on predecessor',
    };
    expect(restoreSupportedPredecessorNewSessionDraftPayloadV2(textOnlyEdit)?.document).toMatchObject({
      composer: { text: { value: 'edited on predecessor' } },
      target: { authoring: { executionTarget } },
    });

    expect(restoreSupportedPredecessorNewSessionDraftPayloadV2(payload(
      { mutationId: baseMutationId, value: 'home-a' },
      { mutationId: machineMutationId, value: 'machine-b' },
    ))?.document).toMatchObject({ target: { authoring: { executionTarget: {
      mutationId: machineMutationId,
      value: { kind: 'machine', target: { serverId: 'home-a', machineId: 'machine-b' } },
    } } } });

    expect(restoreSupportedPredecessorNewSessionDraftPayloadV2(payload(
      { mutationId: serverMutationId, value: 'home-b' },
      { mutationId: machineMutationId, value: 'machine-b' },
    ))?.document).toMatchObject({ target: { authoring: { executionTarget: {
      mutationId: machineMutationId,
      value: { kind: 'machine', target: { serverId: 'home-b', machineId: 'machine-b' } },
    } } } });

    expect(restoreSupportedPredecessorNewSessionDraftPayloadV2(payload(
      { mutationId: baseMutationId, value: 'home-a' },
      { mutationId: machineMutationId, value: null },
    ))?.document).toMatchObject({ target: { authoring: { executionTarget: {
      mutationId: machineMutationId,
      value: null,
    } } } });

    expect(restoreSupportedPredecessorNewSessionDraftPayloadV2(payload(
      { mutationId: serverMutationId, value: 'home-b' },
      { mutationId: baseMutationId, value: 'machine-a' },
    ))).toBeNull();
    expect(restoreSupportedPredecessorNewSessionDraftPayloadV2(payload(undefined,
      { mutationId: machineMutationId, value: 'machine-b' },
    ))).toBeNull();
  });

  it('refuses to downgrade a newSession field the supported predecessor cannot preserve', () => {
    const base = {
      v: 2 as const,
      composer: { text: field('hello'), mentions: field([]), attachments: field([]) },
      target: { kind: 'newSession' as const, authoring: {} },
      extensions: {},
    };
    expect(projectNewSessionDraftDocumentToSupportedPredecessorV1({
      ...base,
      target: { ...base.target, authoring: { temporaryComputerActivationRef: field(null) } },
    })).toBeNull();
    expect(projectNewSessionDraftDocumentToSupportedPredecessorV1({
      ...base,
      target: { ...base.target, authoring: { access: field(null) } },
    })).toBeNull();
    expect(projectNewSessionDraftDocumentToSupportedPredecessorV1({
      ...base,
      target: { ...base.target, authoring: { executionTarget: field({
        kind: 'temporary_computer', serverId: 'home-a', artifactTarget: 'linux-x64', workspace: { kind: 'endpoint_home' },
      }) } },
    })).toBeNull();
  });

  it('keeps plural Automation authoring available through the current V2 document', () => {
    const pluralAutomation = {
      enabled: true,
      name: 'Review',
      description: 'Run from either occurrence',
      triggers: [{
        clientId: 'schedule-1',
        kind: 'schedule',
        persisted: null,
        enabled: true,
        definition: {
          kind: 'schedule',
          schedule: { kind: 'interval', everyMs: 60_000, scheduleExpr: null, timezone: null },
        },
      }],
    };
    const payload = {
      v: 2,
      address: { kind: 'newSession', draftId: '00000000-0000-4000-8000-00000000000a' },
      document: {
        v: 2,
        target: { kind: 'newSession', authoring: { automation: field(pluralAutomation) } },
        composer: { text: field(''), mentions: field([]), attachments: field([]) },
        extensions: {},
      },
    };

    expect(SessionDraftPrivatePayloadV2Schema.parse(payload)).toEqual(payload);
    expect(SessionDraftPrivatePayloadV1Schema.safeParse({
      ...payload,
      v: 1,
      document: { ...payload.document, v: 1 },
    }).success).toBe(false);
  });

  it('preserves the exact Machine and informational Pool origin in a V2 draft', () => {
    const payload = {
      v: 2,
      address: { kind: 'newSession', draftId: '00000000-0000-4000-8000-00000000000a' },
      document: {
        v: 2,
        target: {
          kind: 'newSession',
          authoring: {
            executionTarget: field({
              kind: 'machine',
              target: { serverId: 'home-a', machineId: 'machine-a' },
              selectionOrigin: {
                kind: 'machine_pool',
                poolId: '11111111-1111-4111-8111-111111111111',
              },
            }),
          },
        },
        composer: { text: field('keep this prompt'), mentions: field([]), attachments: field([]) },
        extensions: {},
      },
    };
    expect(SessionDraftPrivatePayloadV2Schema.parse(payload)).toEqual(payload);
    expect(SessionDraftDocumentV1Schema.safeParse({ ...payload.document, v: 1 }).success).toBe(false);
  });

  it('preserves a Temporary computer selection and its non-authoritative activation reference at the existing newSession address', () => {
    const address = { kind: 'newSession', draftId: '00000000-0000-4000-8000-00000000000a' };
    const document = {
      v: 2,
      target: {
        kind: 'newSession',
        authoring: {
          executionTarget: field({
            kind: 'temporary_computer',
            serverId: 'home-a',
            artifactTarget: 'linux-x64',
            workspace: { kind: 'choose_on_endpoint' },
          }),
          temporaryComputerActivationRef: field({
            v: 1,
            activationId: '00000000-0000-4000-8000-00000000000b',
            createdOnDeviceLabel: 'My laptop',
          }),
        },
      },
      composer: { text: field('keep this prompt'), mentions: field([]), attachments: field([]) },
      extensions: {},
    };
    const payload = { v: 2, address, document };
    expect(SessionDraftPrivatePayloadV2Schema.safeParse(payload).success).toBe(true);
    expect(SessionDraftPrivatePayloadV1Schema.safeParse(payload).success).toBe(false);
    expect(SessionDraftDocumentV1Schema.safeParse({ ...document, v: 1 }).success).toBe(false);
    expect(SessionDraftPrivatePayloadV2Schema.safeParse({
      ...payload,
      document: {
        ...document,
        target: {
          ...document.target,
          authoring: {
            ...document.target.authoring,
            temporaryComputerActivationRef: field({
              ...document.target.authoring.temporaryComputerActivationRef.value,
              privateKeyHandle: 'must-remain-local',
            }),
          },
        },
      },
    }).success).toBe(false);
  });

  it('keeps exact-Machine execution targeting in the V2 draft epoch because released V1 rejects that field id', () => {
    const releasedV1 = {
      v: 1,
      target: { kind: 'newSession', authoring: {} },
      composer: { text: field('legacy prompt'), mentions: field([]), attachments: field([]) },
      extensions: {},
    };
    expect(SessionDraftDocumentV1Schema.safeParse(releasedV1).success).toBe(true);
    const current = {
      v: 2,
      target: {
        kind: 'newSession',
        authoring: {
          executionTarget: field({
            kind: 'machine',
            target: { serverId: 'home-a', machineId: 'machine-a' },
          }),
        },
      },
      composer: releasedV1.composer,
      extensions: {},
    } as const;
    expect(SessionDraftDocumentV1Schema.safeParse({
      ...releasedV1,
      target: { kind: 'newSession', authoring: { executionTarget: field({ serverId: 'home-a', machineId: 'machine-a' }) } },
    }).success).toBe(false);
    expect(SessionDraftPrivatePayloadV2Schema.safeParse({
      v: 2,
      address: { kind: 'newSession', draftId: '00000000-0000-4000-8000-00000000000a' },
      document: current,
    }).success).toBe(true);
  });

  it('binds a run address to the label-free manual recipient of the same run', () => {
    expect(SessionDraftPrivatePayloadV2Schema.safeParse({
      v: 2,
      address: { kind: 'run', sessionId: 's1', runId: 'r1' },
      document: runDocument('r1'),
    }).success).toBe(true);
    expect(SessionDraftPrivatePayloadV2Schema.safeParse({
      v: 2,
      address: { kind: 'run', sessionId: 's1', runId: 'r1' },
      document: runDocument('r2'),
    }).success).toBe(false);
  });

  it('accepts a labelled authored recipient because routing identity is normalized', () => {
    const document = runDocument('r1');
    const labelled = {
      ...document,
      target: {
        ...document.target,
        routing: {
          ...document.target.routing,
          recipient: field({
            mode: 'manual',
            recipient: { kind: 'execution_run', runId: 'r1', label: 'Run A' },
          }),
        },
      },
    };
    expect(SessionDraftPrivatePayloadV2Schema.safeParse({
      v: 2,
      address: { kind: 'run', sessionId: 's1', runId: 'r1' },
      document: labelled,
    }).success).toBe(true);
  });

  it('rejects a run address bound to a discussion document or a missing recipient', () => {
    expect(SessionDraftPrivatePayloadV2Schema.safeParse({
      v: 2,
      address: { kind: 'run', sessionId: 's1', runId: 'r1' },
      document: discussionDocument('discussion'),
    }).success).toBe(false);
    const document = runDocument('r1');
    expect(SessionDraftPrivatePayloadV2Schema.safeParse({
      v: 2,
      address: { kind: 'run', sessionId: 's1', runId: 'r1' },
      document: {
        ...document,
        target: {
          ...document.target,
          routing: { ...document.target.routing, recipient: field(null) },
        },
      },
    }).success).toBe(false);
  });

  it('binds discussion addresses to the human document target of the same kind', () => {
    expect(SessionDraftPrivatePayloadV2Schema.safeParse({
      v: 2,
      address: { kind: 'discussion', sessionId: 's1', discussionId: 'd1' },
      document: discussionDocument('discussion'),
    }).success).toBe(true);
    expect(SessionDraftPrivatePayloadV2Schema.safeParse({
      v: 2,
      address: { kind: 'newDiscussion', sessionId: 's1' },
      document: discussionDocument('discussion'),
    }).success).toBe(false);
    expect(SessionDraftPrivatePayloadV2Schema.safeParse({
      v: 2,
      address: { kind: 'discussion', sessionId: 's1', discussionId: 'd1' },
      document: runDocument('r1'),
    }).success).toBe(false);
  });
});

describe('human discussion draft document', () => {
  it('carries only human composer fields and a new-discussion title', () => {
    expect(SessionDiscussionDraftDocumentV2Schema.safeParse({
      ...discussionDocument('newDiscussion'),
      title: { mutationId: titleMutationId, value: 'Release plan' },
    }).success).toBe(true);
    expect(SessionDiscussionDraftDocumentV2Schema.safeParse({
      ...discussionDocument('discussion'),
      title: { mutationId: titleMutationId, value: 'Release plan' },
    }).success).toBe(false);
  });

  it('rejects Agent routing, delivery and attachment bytes in a human document', () => {
    expect(SessionDiscussionDraftDocumentV2Schema.safeParse({
      ...discussionDocument('discussion'),
      target: { kind: 'discussion', routing: {} },
    }).success).toBe(false);
    expect(SessionDiscussionDraftDocumentV2Schema.safeParse({
      ...discussionDocument('discussion'),
      composer: {
        ...discussionDocument('discussion').composer,
        attachments: field([{ kind: 'file' }]),
      },
    }).success).toBe(false);
  });
});
