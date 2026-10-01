import { describe, expect, it } from 'vitest';
import { SessionTerminalTargetV1Schema } from './workspace';

describe('session terminal target ownership', () => {
  it('requires the dedicated attached target instead of smuggling an agent attachment into an owned shell', () => {
    expect(SessionTerminalTargetV1Schema.safeParse({ kind: 'workspace_shell', launch: { kind: 'session_attach', sessionId: 'other-session' } }).success).toBe(false);
    expect(SessionTerminalTargetV1Schema.safeParse({ kind: 'session_attach' }).success).toBe(true);
  });
});
