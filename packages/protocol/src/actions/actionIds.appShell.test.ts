import { describe, expect, it } from 'vitest';
import { ActionIdSchema } from './actionIds.js';

describe('app shell Action identity', () => {
  it('makes existing Inbox acknowledgement and draft deletion discoverable by exact Action identity', () => {
    expect(ActionIdSchema.safeParse('inbox.mark_all_read').success).toBe(true);
    expect(ActionIdSchema.safeParse('session.draft.delete').success).toBe(true);
  });
});
