import type { AgentTranscriptIdentityCodec } from '@happier-dev/plugin-sdk/agents/runtime';

function record(value: unknown): Readonly<Record<string, unknown>> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Readonly<Record<string, unknown>> : null;
}

export const openCodeTranscriptIdentityCodec = Object.freeze({
  metadataFields: ['opencodeUserMessageIdMapV1'],
  messageMetadataFields: ['opencodeMessageId', 'opencodeRemoteSessionId', 'remoteSessionId', 'providerSessionId'],
  reconcile({ providerSessionId, facts, metadata, baseline }) {
    const committed = new Set<string>();
    const authored = new Set<string>();
    const factsById = new Map(facts.map((fact) => [fact.sourceMessageId, fact]));
    const currentLocalIds = new Map(facts.map((fact) => [fact.localId, fact]));
    // Legacy delimiter concatenation is not injective. Match only with a separate exact SID witness.
    const legacyLocalIds = new Map(facts.map((fact) => [`opencode:import:history:${providerSessionId}:${fact.sourceMessageId}`, fact]));
    const tupleLocalIds = new Map(facts.map((fact) => [`opencode:import:v2:${JSON.stringify(['history', providerSessionId, null, fact.sourceMessageId])}`, fact]));
    const mapping = record(metadata.opencodeUserMessageIdMapV1);
    const userMap = mapping?.v === 1 ? record(mapping.byLocalId) : null;
    let unmappedUsers = 0;
    let unmappedAgents = 0;
    for (const row of baseline.rows) {
      const savedSessionId = row.meta.opencodeRemoteSessionId ?? row.meta.remoteSessionId ?? row.meta.providerSessionId;
      if (typeof savedSessionId === 'string' && savedSessionId !== providerSessionId) continue;
      const imported = row.localId ? currentLocalIds.get(row.localId)
        ?? (savedSessionId === providerSessionId ? tupleLocalIds.get(row.localId) ?? legacyLocalIds.get(row.localId) : undefined) : undefined;
      if (imported && (row.role === 'user' ? imported.role === 'user' : imported.role === 'assistant')) {
        committed.add(imported.sourceMessageId);
        continue;
      }
      const mappedId = row.role === 'user' && row.localId ? userMap?.[row.localId] : row.meta.opencodeMessageId;
      if (typeof mappedId === 'string' && mappedId.length > 0 && (row.role === 'user' || savedSessionId === providerSessionId)) {
        const fact = factsById.get(mappedId);
        if (fact && (row.role === 'user' ? fact.role === 'user' : fact.role === 'assistant')) {
          committed.add(mappedId);
          if (row.role === 'user') authored.add(mappedId);
        }
        continue;
      }
      if (row.role === 'user') unmappedUsers += 1;
      else unmappedAgents += 1;
    }
    return { committedSourceMessageIds: [...committed], hostAuthoredUserMessageIds: [...authored],
      coverage: { complete: baseline.complete && unmappedUsers === 0 && unmappedAgents === 0, unmappedUsers, unmappedAgents } };
  },
} satisfies AgentTranscriptIdentityCodec);
