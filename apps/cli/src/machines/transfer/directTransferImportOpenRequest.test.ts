import { describe, expect, it } from 'vitest';

import { DirectTransferImportOpenRequestSchema } from './directTransferImportOpenRequest';

describe('direct attachment import request admission', () => {
  it('requires an explicit Session identity and keeps the upload routing envelope closed', () => {
    const request = {
      t: 'session_attachment_upload_v1',
      workingDirectory: '/session',
      messageLocalId: 'message-a',
      fileName: 'notes.txt',
      sizeBytes: 3,
      uploadLocation: 'workspace',
      workspaceRelativeDir: '.happier/attachments',
      vcsIgnoreStrategy: 'none',
      vcsIgnoreWritesEnabled: false,
    };

    expect(DirectTransferImportOpenRequestSchema.safeParse(request).success).toBe(false);
    expect(DirectTransferImportOpenRequestSchema.safeParse({ ...request, sessionId: '' }).success).toBe(false);
    expect(DirectTransferImportOpenRequestSchema.safeParse({ ...request, sessionId: 'session-a', machineId: 'other-machine' }).success).toBe(false);
    expect(DirectTransferImportOpenRequestSchema.safeParse({ ...request, sessionId: 'session-a' })).toMatchObject({
      success: true,
      data: { sessionId: 'session-a', messageLocalId: 'message-a', workingDirectory: '/session' },
    });
  });
});
