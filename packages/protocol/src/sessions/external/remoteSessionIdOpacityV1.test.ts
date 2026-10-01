import { describe, expect, it } from 'vitest';

import { readNonBlankOpaqueIdentifier } from '../../strings/opaqueIdentifier.js';
import { SESSION_OWNER_METADATA_VERSION_V1, SessionOwnerMetadataV1Schema } from '../metadata/sessionMetadataEnvelopesV1.js';
import { ExternalSessionCandidateV1Schema } from './daemonRpcV1.js';
import {
  ExternalHistoryImportV1Schema,
  readNonAuthoritativeLinkedExternalSessionV1FromMetadata,
} from './linkedSessionMetadata.js';
import { ExternalSessionTakeoverStartInputV1Schema } from './operationActionSchemasV1.js';
import { ExternalSessionOperationSemanticRequestV1Schema } from './operationV1.js';
import { ExternalSessionTranscriptRefreshBindingV1Schema } from './secureRefreshV1.js';
import { ExternalSessionRefSchema } from './sourceCatalog.js';
import { ExternalSessionDestructiveSourceIdentityV1Schema } from './takeoverV1.js';

/**
 * `remoteSessionId` is minted by the Agent, not by Happier: every Protocol
 * carrier hands it back to the source that issued it. Surrounding whitespace,
 * embedded newlines, `/`, `+` and `=` are therefore part of the identity, and
 * the only judgement Protocol makes is presence — the decision owned by
 * `NonBlankOpaqueIdentifierSchema`. A carrier that trims, or that admits an
 * all-whitespace value, is a second decision-maker for that identity.
 */
const PROVIDER_MINTED_REMOTE_SESSION_ID = '  provider\nses/AB+cd==  ';
const BLANK_REMOTE_SESSION_ID = ' \n\t ';

const qualifiedIdentity = {
  v: 1,
  agent: { pluginId: 'happier.codex', localId: 'codex' },
  source: { kind: 'codexHome', contractVersion: 1 },
} as const;

/** Each carrier parses a fixture and projects the `remoteSessionId` it kept. */
const CARRIERS: readonly Readonly<{
  name: string;
  read: (remoteSessionId: string) => string | undefined;
}>[] = [
  {
    name: 'ExternalSessionRefSchema',
    read: (remoteSessionId) => {
      const parsed = ExternalSessionRefSchema.safeParse({
        agentId: 'codex',
        sourceId: 'codexHome:user:::',
        remoteSessionId,
      });
      return parsed.success ? parsed.data.remoteSessionId : undefined;
    },
  },
  {
    name: 'LinkedExternalSessionV1 (externalSessionV1 owner metadata)',
    read: (remoteSessionId) => readNonAuthoritativeLinkedExternalSessionV1FromMetadata({
      externalSessionV1: {
        v: 1,
        agentId: 'codex',
        machineId: 'machine-1',
        remoteSessionId,
        source: { kind: 'codexHome', home: 'user' },
      },
    })?.remoteSessionId,
  },
  {
    name: 'ExternalHistoryImportV1Schema',
    read: (remoteSessionId) => {
      const parsed = ExternalHistoryImportV1Schema.safeParse({
        v: 1,
        agentId: 'codex',
        remoteSessionId,
        importedAtMs: 100,
        source: { kind: 'codexHome', home: 'user' },
      });
      return parsed.success ? parsed.data.remoteSessionId : undefined;
    },
  },
  {
    name: 'ExternalSessionOperationSemanticRequestV1Schema',
    read: (remoteSessionId) => {
      const parsed = ExternalSessionOperationSemanticRequestV1Schema.safeParse({
        v: 1,
        idempotencyKey: 'materialize-1',
        sessionId: 'session-1',
        source: {
          machineId: 'machine-1',
          remoteSessionId,
          qualifiedIdentity,
          linkGeneration: 'link-generation-1',
          sourceGeneration: 'source-generation-1',
          sourceCustody: { kind: 'development', registeredRootId: 'development-root-1' },
        },
        plan: 'materialize',
        targetStorageMode: 'external-linked',
        targetRuntimeMode: null,
      });
      return parsed.success ? parsed.data.source.remoteSessionId : undefined;
    },
  },
  {
    name: 'ExternalSessionTakeoverStartInputV1Schema',
    read: (remoteSessionId) => {
      const parsed = ExternalSessionTakeoverStartInputV1Schema.safeParse({
        request: {
          v: 1,
          idempotencyKey: 'takeover-1',
          sessionId: 'session-1',
          source: {
            machineId: 'machine-1',
            remoteSessionId,
            qualifiedIdentity,
            linkGeneration: 'link-generation-1',
          },
          plan: 'takeover',
          targetStorageMode: 'persisted',
          targetDirectory: '/local/selected/workspace',
          targetRuntimeMode: 'terminal',
        },
      });
      return parsed.success ? parsed.data.request.source.remoteSessionId : undefined;
    },
  },
  {
    name: 'ExternalSessionDestructiveSourceIdentityV1Schema',
    read: (remoteSessionId) => {
      const parsed = ExternalSessionDestructiveSourceIdentityV1Schema.safeParse({
        machineId: 'machine-1',
        linkedSessionId: 'session-1',
        remoteSessionId,
        linkGeneration: 'link-generation-1',
        sourceKey: 'codexHome:instance-1',
        qualifiedIdentity,
      });
      return parsed.success ? parsed.data.remoteSessionId : undefined;
    },
  },
  {
    name: 'ExternalSessionTranscriptRefreshBindingV1Schema',
    read: (remoteSessionId) => {
      const parsed = ExternalSessionTranscriptRefreshBindingV1Schema.safeParse({
        v: 1,
        machineId: 'machine-1',
        sessionId: 'session-1',
        link: { generation: 'link-generation-1', remoteSessionId },
        source: { qualifiedIdentity, generation: 'source-generation-1' },
        sourceCustody: { kind: 'development', registeredRootId: 'source-root-1' },
        cursorIdentity: `external_session_cursor_binding_v1:${'a'.repeat(64)}`,
      });
      return parsed.success ? parsed.data.link.remoteSessionId : undefined;
    },
  },
  {
    name: 'ExternalSessionCandidateV1Schema',
    read: (remoteSessionId) => {
      const parsed = ExternalSessionCandidateV1Schema.safeParse({
        remoteSessionId,
        updatedAtMs: 1_700,
      });
      return parsed.success ? parsed.data.remoteSessionId : undefined;
    },
  },
  {
    name: 'SessionOwnerMetadataV1Schema history.acpHistoryImportV1',
    read: (remoteSessionId) => {
      const parsed = SessionOwnerMetadataV1Schema.safeParse({
        v: SESSION_OWNER_METADATA_VERSION_V1,
        history: {
          acpHistoryImportV1: {
            v: 1,
            agentId: 'opencode',
            remoteSessionId,
            importedAt: 12,
          },
        },
      });
      return parsed.success ? parsed.data.history?.acpHistoryImportV1?.remoteSessionId : undefined;
    },
  },
];

describe('External Sessions provider-minted remote session identity', () => {
  it('uses the canonical opaque-identifier reader without changing identity bytes', () => {
    expect(readNonBlankOpaqueIdentifier(PROVIDER_MINTED_REMOTE_SESSION_ID))
      .toBe(PROVIDER_MINTED_REMOTE_SESSION_ID);
    expect(readNonBlankOpaqueIdentifier(BLANK_REMOTE_SESSION_ID)).toBeNull();
  });

  it.each(CARRIERS.map((carrier) => [carrier.name, carrier] as const))(
    '%s keeps the exact provider bytes and still rejects a blank identity',
    (_name, carrier) => {
      expect(carrier.read(PROVIDER_MINTED_REMOTE_SESSION_ID))
        .toBe(PROVIDER_MINTED_REMOTE_SESSION_ID);
      expect(carrier.read(BLANK_REMOTE_SESSION_ID)).toBeUndefined();
    },
  );

  it('measures the released remote session id bound on the preserved bytes', () => {
    const atBound = `  ${'x'.repeat(1_996)}  `;

    expect(ExternalSessionRefSchema.safeParse({
      agentId: 'codex',
      sourceId: 'codexHome:user:::',
      remoteSessionId: atBound,
    }).success).toBe(true);
    expect(ExternalSessionRefSchema.safeParse({
      agentId: 'codex',
      sourceId: 'codexHome:user:::',
      remoteSessionId: `${atBound} `,
    }).success).toBe(false);
  });
});
