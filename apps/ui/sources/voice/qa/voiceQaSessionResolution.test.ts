import { beforeEach, describe, expect, it } from 'vitest';

import { storage } from '@/sync/domains/state/storage';
import { getActiveServerSnapshot } from '@/sync/domains/server/serverRuntime';

import {
  assertLocalVoiceAgentSupportedForQa,
  isHiddenVoiceQaConversationSessionId,
  resolveConfiguredVoiceQaProvider,
  syncLatestLocalVoiceQaResolvedSessions,
  resolveEffectiveVoiceQaSessionAddress,
} from './voiceQaSessionResolution';

// The hydrated `sessions` entry is the active Home's entity, so its canonical row must live
// under the same Home; a bare session id resolves through that address.
const activeServerId = getActiveServerSnapshot().serverId;

describe('voiceQaSessionResolution', () => {
  beforeEach(() => {
    storage.setState((current) => ({
      ...current,
      sessions: {
        s1: {
          id: 's1',
          metadata: {
            path: '/tmp/project-a',
          },
        },
      },
      sessionListRowsByServerId: {
        [activeServerId]: {
          s1: {
            id: 's1',
            updatedAt: 0,
            metadata: {
              path: '/tmp/project-a',
              systemSessionV1: {
                v: 1,
                key: 'voice_conversation',
                hidden: true,
              },
            },
          },
        },
      },
      ordinarySessionListMembershipByServerId: { [activeServerId]: ['s1'] },
      sessionListIndexByServerId: {
        [activeServerId]: [
          { type: 'session', sessionId: 's1', serverId: activeServerId, serverName: 'Server A' },
        ],
      },
      concurrentSessionListCacheByServerId: {},
    } as any));
  });

  it('prefers visible lookup hidden-session metadata over stale raw session metadata', () => {
    expect(isHiddenVoiceQaConversationSessionId('s1')).toBe(true);
  });

  it('normalizes the control session id before syncing latest QA resolution state', () => {
    const calls: Array<Readonly<{ targetSessionAddress: { serverId: string; sessionId: string } | null; runtimeSessionId: string | null }>> = [];
    syncLatestLocalVoiceQaResolvedSessions(
      {
        getVoiceTargetState: () => ({ primaryActionSessionAddress: { serverId: 'server-b', sessionId: 'target-1' }, lastFocusedSessionAddress: null }),
        getLocalBinding: () => null,
        qaStore: {
          getState: () => ({
            setResolvedSessions: (params: Readonly<{ targetSessionAddress: { serverId: string; sessionId: string } | null; runtimeSessionId: string | null }>) => {
              calls.push(params);
            },
          }),
        },
      },
      ' __voice_agent__ ',
      null,
    );

    expect(calls).toEqual([
      {
        targetSessionAddress: { serverId: 'server-b', sessionId: 'target-1' },
        runtimeSessionId: '__voice_agent__',
      },
    ]);
  });

  it('rejects an ambiguous bare target without changing the QA store', () => {
    storage.setState({ sessionListIndexByServerId: {
      a: [{ type: 'session', sessionId: 'same', serverId: 'a', serverName: 'A' }],
      b: [{ type: 'session', sessionId: 'same', serverId: 'b', serverName: 'B' }],
    } });
    expect(() => resolveEffectiveVoiceQaSessionAddress('same', () => ({
      primaryActionSessionAddress: { serverId: 'a', sessionId: 'same' },
      lastFocusedSessionAddress: null,
    }))).toThrow('voice_qa_target_session_unresolved');
  });

  it('reads local conversation agent mode from the canonical provider envelope only', () => {
    expect(() => assertLocalVoiceAgentSupportedForQa({
      voice: {
        providerId: 'local_conversation',
        providers: {
          local_conversation: {
            schemaVersion: 1,
            config: { conversationMode: 'agent' },
          },
        },
      },
    })).not.toThrow();
  });

  it('classifies a registered conversation provider by capability instead of a vendor id', () => {
    expect(resolveConfiguredVoiceQaProvider({
      voice: { providerId: 'happier.voice.elevenlabs/realtime-elevenlabs' },
    })).toBe('realtime_conversation');
  });
});
