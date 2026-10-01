import { describe, expect, it } from 'vitest';
import { createExecutionRunPermissionHandler } from './executionRunPermissionDecision';

describe('execution-run hands-off permission ceiling', () => {
  it('denies writes and unsafe shell before YOLO while preserving coordination', async () => {
    const handler = createExecutionRunPermissionHandler({ permissionMode: 'yolo', backendId: 'codex', workspaceWrites: 'deny' });
    await expect(handler.handleToolCall('write', 'Write', { path: '/repo/a' })).resolves.toEqual({ decision: 'denied' });
    expect(handler.getImmediateDecision('shell', 'Bash', { command: 'git status > changed.txt' })).toEqual({ decision: 'denied' });
    expect(handler.getImmediateDecision('read', 'Bash', { command: 'git status' })).not.toEqual({ decision: 'denied' });
    expect(handler.getImmediateDecision('spawn', 'mcp__happier__session_spawn_new', {})).not.toEqual({ decision: 'denied' });
  });
});
