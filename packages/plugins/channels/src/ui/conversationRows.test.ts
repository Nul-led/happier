import { describe, expect, it } from 'vitest';

import { readChannelsPageLocation } from './conversationRows.js';

describe('readChannelsPageLocation', () => {
  it('reads the link journey, optionally on one named bot (a session tab\'s "+" picks the bot first)', () => {
    expect(readChannelsPageLocation('link')).toEqual({ step: 'link' });
    expect(readChannelsPageLocation('link/connection-1')).toEqual({ step: 'link', connectionId: 'connection-1' });
    expect(readChannelsPageLocation('binding-1/edit')).toEqual({ bindingId: 'binding-1', step: 'edit' });
    expect(readChannelsPageLocation('binding-1')).toEqual({ bindingId: 'binding-1' });
  });
});
