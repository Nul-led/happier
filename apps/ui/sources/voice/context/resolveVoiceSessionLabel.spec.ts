import { getActiveServerSnapshot } from '@/sync/domains/server/serverRuntime';
import { beforeEach, describe, expect, it } from 'vitest';

import { storage } from '@/sync/domains/state/storage';

import { resolveVoiceSessionLabel } from './resolveVoiceSessionLabel';

describe('resolveVoiceSessionLabel', () => {
  it('does not use another Home raw metadata when the qualified target is unavailable', () => {
    storage.setState((state) => ({
      ...state,
      sessions: { same: { id: 'same', metadata: { summaryText: 'Active Home private title' } } },
    }) as never);
    expect(resolveVoiceSessionLabel({ serverId: 'unavailable-home', sessionId: 'same' }, {
      voiceShareSessionSummary: true, voiceShareFilePaths: false,
    })).toBe('the current session');
  });
  beforeEach(() => {
    storage.setState((state: any) => ({
      ...state,
      sessions: {},
      sessionListRowsByServerId: {},
      ordinarySessionListMembershipByServerId: {},
      sessionListIndexByServerId: {},
      concurrentSessionListCacheByServerId: {},
    }));
  });

  it('prefers the visible lookup session metadata over stale raw session metadata', () => {
    storage.setState((state: any) => ({
      ...state,
      sessions: {
        s_matrix: {
          id: 's_matrix',
          metadata: {
            summaryText: 'Raw session summary!',
            path: '/Users/alice/project-alpha',
          },
        },
      },
      sessionListRowsByServerId: {
        [getActiveServerSnapshot().serverId]: {
          s_matrix: {
            id: 's_matrix',
            updatedAt: 42,
            metadata: {
              summaryText: 'Lookup session summary',
              path: '/Users/alice/project-alpha',
            },
          },
        },
      },
      ordinarySessionListMembershipByServerId: {
        [getActiveServerSnapshot().serverId]: ['s_matrix'],
      },
      sessionListIndexByServerId: {
        [getActiveServerSnapshot().serverId]: [
          {
            type: 'session',
            sessionId: 's_matrix',
            serverId: getActiveServerSnapshot().serverId,
            serverName: 'Active',
          },
        ],
      },
    }));

    expect(
      resolveVoiceSessionLabel('s_matrix', {
        voiceShareSessionSummary: true,
        voiceShareFilePaths: true,
      }),
    ).toBe('Lookup session summary');
  });

  it('trims the session id before resolving the label', () => {
    storage.setState((state: any) => ({
      ...state,
      sessions: {
        s_matrix: {
          id: 's_matrix',
          metadata: {
            summaryText: 'Raw session summary!',
            path: '/Users/alice/project-alpha',
          },
        },
      },
      sessionListRowsByServerId: {
        [getActiveServerSnapshot().serverId]: {
          s_matrix: {
            id: 's_matrix',
            updatedAt: 42,
            metadata: {
              summaryText: 'Trimmed session summary',
              path: '/Users/alice/project-alpha',
            },
          },
        },
      },
      ordinarySessionListMembershipByServerId: {
        [getActiveServerSnapshot().serverId]: ['s_matrix'],
      },
      sessionListIndexByServerId: {
        [getActiveServerSnapshot().serverId]: [
          {
            type: 'session',
            sessionId: 's_matrix',
            serverId: getActiveServerSnapshot().serverId,
            serverName: 'Active',
          },
        ],
      },
    }));

    expect(
      resolveVoiceSessionLabel(' s_matrix ', {
        voiceShareSessionSummary: true,
        voiceShareFilePaths: true,
      }),
    ).toBe('Trimmed session summary');
  });

  it('does not disclose a raw session name when summary sharing is disabled', () => {
    storage.setState((state: any) => ({
      ...state,
      sessions: {
        s_matrix: {
          id: 's_matrix',
          metadata: {
            name: 'Raw session name',
            path: '/Users/alice/project-alpha',
          },
        },
      },
      sessionListIndexByServerId: {},
    }));

    expect(
      resolveVoiceSessionLabel(' s_matrix ', {
        voiceShareSessionSummary: false,
        voiceShareFilePaths: true,
      }),
    ).toBe('project-alpha');
  });

  it.each([undefined, null, 'true', 1, {}, []])(
    'fails closed for omitted or malformed privacy prefs=%p',
    (privacyPrefs) => {
      const label = Reflect.apply(resolveVoiceSessionLabel, undefined, [
        's_private',
        privacyPrefs,
        {
          metadata: {
            summaryText: 'PRIVATE SESSION SUMMARY',
            path: '/Users/alice/Company/PrivateProject',
          },
        },
      ]);

      expect(label).toBe('the current session');
      expect(label).not.toContain('PRIVATE SESSION SUMMARY');
      expect(label).not.toContain('PrivateProject');
    },
  );

  it('uses only the layout-v1 owner view for private path labels', () => {
    storage.setState((state: any) => ({
      ...state,
      sessions: {
        s_private: {
          id: 's_private',
          metadataLayoutVersion: 1,
          metadata: { v: 1, path: '/shared/private-lookalike' },
          ownerMetadataView: { path: '/owner/real-project' },
        },
      },
    }));

    expect(resolveVoiceSessionLabel('s_private', {
      voiceShareSessionSummary: false,
      voiceShareFilePaths: true,
    })).toBe('real-project');

    storage.setState((state: any) => ({
      ...state,
      sessions: {
        ...state.sessions,
        s_private: {
          ...state.sessions.s_private,
          ownerMetadataView: null,
        },
      },
    }));

    expect(resolveVoiceSessionLabel('s_private', {
      voiceShareSessionSummary: false,
      voiceShareFilePaths: true,
    })).toBe('the current session');
  });
});
