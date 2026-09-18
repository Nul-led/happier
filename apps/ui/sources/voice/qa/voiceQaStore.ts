import { create } from 'zustand';

import { normalizeSessionAddress, type SessionAddress } from '@/sync/domains/session/sessionAddress';

import { randomUUID } from '@/platform/randomUUID';

const MAX_VOICE_QA_ENTRIES = 500;

export type VoiceQaProvider = 'local_voice_agent' | 'realtime_conversation';
export type VoiceQaStatus = 'idle' | 'starting' | 'running' | 'stopping' | 'error';
export type VoiceQaEntryKind = 'system' | 'user' | 'assistant' | 'error';

export type VoiceQaEntry = Readonly<{
  id: string;
  ts: number;
  kind: VoiceQaEntryKind;
  text: string;
}>;

type VoiceQaState = Readonly<{
  provider: VoiceQaProvider | null;
  sessionId: string | null;
  targetSessionAddress: SessionAddress | null;
  runtimeSessionId: string | null;
  status: VoiceQaStatus;
  entries: ReadonlyArray<VoiceQaEntry>;
  begin: (
    provider: VoiceQaProvider,
    sessionId: string,
    options?: Readonly<{ targetSessionAddress?: SessionAddress | null; runtimeSessionId?: string | null }>,
  ) => void;
  setStatus: (status: VoiceQaStatus) => void;
  setResolvedSessions: (params: Readonly<{ targetSessionAddress?: SessionAddress | null; runtimeSessionId?: string | null }>) => void;
  clear: () => void;
  appendSystem: (text: string) => void;
  appendUser: (text: string) => void;
  appendAssistant: (text: string) => void;
  appendError: (text: string) => void;
}>;

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function createEntry(kind: VoiceQaEntryKind, text: string): VoiceQaEntry {
  return {
    id: randomUUID(),
    ts: Date.now(),
    kind,
    text,
  };
}

function appendEntry(state: VoiceQaState, entry: VoiceQaEntry): VoiceQaState {
  const retainedEntries = state.entries.length >= MAX_VOICE_QA_ENTRIES
    ? state.entries.slice(-(MAX_VOICE_QA_ENTRIES - 1))
    : state.entries;
  return {
    ...state,
    entries: [...retainedEntries, entry],
  };
}

export const useVoiceQaStore = create<VoiceQaState>((set) => ({
  provider: null,
  sessionId: null,
  targetSessionAddress: null,
  runtimeSessionId: null,
  status: 'idle',
  entries: [],
  begin: (provider, sessionId, options) =>
    set((state) => ({
      ...state,
      provider,
      sessionId: sessionId.trim(),
      targetSessionAddress: normalizeSessionAddress(options?.targetSessionAddress?.serverId, options?.targetSessionAddress?.sessionId),
      runtimeSessionId: normalizeText(options?.runtimeSessionId) || null,
      status: 'starting',
    })),
  setStatus: (status) =>
    set((state) => ({
      ...state,
      status,
    })),
  setResolvedSessions: ({ targetSessionAddress, runtimeSessionId }) =>
    set((state) => ({
      ...state,
      targetSessionAddress: normalizeSessionAddress(targetSessionAddress?.serverId, targetSessionAddress?.sessionId),
      runtimeSessionId: normalizeText(runtimeSessionId) || null,
    })),
  clear: () =>
    set((state) => ({
      ...state,
      entries: [],
    })),
  appendSystem: (text) =>
    set((state) => {
      const normalized = normalizeText(text);
      if (!normalized) return state;
      return appendEntry(state, createEntry('system', normalized));
    }),
  appendUser: (text) =>
    set((state) => {
      const normalized = normalizeText(text);
      if (!normalized) return state;
      return appendEntry(state, createEntry('user', normalized));
    }),
  appendAssistant: (text) =>
    set((state) => {
      const normalized = normalizeText(text);
      if (!normalized) return state;
      return appendEntry(state, createEntry('assistant', normalized));
    }),
  appendError: (text) =>
    set((state) => {
      const normalized = normalizeText(text);
      if (!normalized) return state;
      return appendEntry(state, createEntry('error', normalized));
    }),
}));

export function resetVoiceQaStoreForTests(): void {
  useVoiceQaStore.setState({
    provider: null,
    sessionId: null,
    targetSessionAddress: null,
    runtimeSessionId: null,
    status: 'idle',
    entries: [],
  });
}
