import { describe, expect, it } from 'vitest';

import {
  readVoiceContentDisclosureV1,
  resolveVoiceSessionUpdatePolicyV1,
  resolveVoiceSourceDisclosureV1,
} from './sourceDisclosureV1.js';

describe('Voice source disclosure', () => {
  it('shares only on an explicit true, so a malformed value cannot inherit a default', () => {
    expect(readVoiceContentDisclosureV1({
      voice: { privacy: { shareSessionSummary: 'yes', shareRecentMessages: 1 } },
    })).toEqual({ shareSessionSummary: false, shareRecentMessages: false });
    expect(readVoiceContentDisclosureV1({ voice: { privacy: {} } }))
      .toEqual({ shareSessionSummary: false, shareRecentMessages: false });
    expect(readVoiceContentDisclosureV1(null))
      .toEqual({ shareSessionSummary: false, shareRecentMessages: false });
    expect(readVoiceContentDisclosureV1({
      voice: { privacy: { shareSessionSummary: true, shareRecentMessages: true } },
    })).toEqual({ shareSessionSummary: true, shareRecentMessages: true });
  });

  it('bounds an explicitly shared class by the source update level', () => {
    const accountSettings = {
      voice: {
        privacy: { shareSessionSummary: true, shareRecentMessages: true },
        ui: { updates: { activeSession: 'summaries', otherSessions: 'activity' } },
      },
    };

    expect(resolveVoiceSourceDisclosureV1({ accountSettings, includeInVoice: true })).toEqual({
      level: 'summaries',
      shareSessionSummary: true,
      // `summaries` describes work; it never quotes transcript text.
      shareRecentMessages: false,
    });
    expect(resolveVoiceSourceDisclosureV1({ accountSettings })).toEqual({
      level: 'activity',
      shareSessionSummary: false,
      shareRecentMessages: false,
    });
  });

  it('withholds transcript text at snippets when the Account switch is off', () => {
    expect(resolveVoiceSourceDisclosureV1({
      accountSettings: {
        voice: {
          privacy: { shareSessionSummary: true, shareRecentMessages: false },
          ui: { updates: { activeSession: 'snippets' } },
        },
      },
      includeInVoice: true,
    })).toEqual({ level: 'snippets', shareSessionSummary: true, shareRecentMessages: false });
  });

  it('keeps an unopted source off the active level and narrows non-auto snippets', () => {
    const policy = resolveVoiceSessionUpdatePolicyV1({
      accountSettings: { voice: { ui: { updates: { otherSessions: 'snippets' } } } },
    });
    expect(policy).toEqual({
      level: 'summaries',
      isIncludedInVoice: false,
      includeUserMessagesInSnippets: false,
      snippetsMaxMessages: 3,
    });
    expect(resolveVoiceSessionUpdatePolicyV1({
      accountSettings: {
        voice: { ui: { updates: { otherSessions: 'snippets', otherSessionsSnippetsMode: 'auto', snippetsMaxMessages: 99 } } },
      },
    })).toMatchObject({ level: 'snippets', snippetsMaxMessages: 10 });
  });
});
