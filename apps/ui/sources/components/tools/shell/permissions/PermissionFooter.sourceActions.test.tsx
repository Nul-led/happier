import * as React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { createTestSessionTranscriptSource, pressTestInstanceAsync, renderWithSessionTranscriptSource } from '@/dev/testkit';
import { PermissionFooter } from './PermissionFooter';
import { installPermissionShellCommonModuleMocks } from './permissionShellTestHelpers';

installPermissionShellCommonModuleMocks();

describe('PermissionFooter source authority', () => {
    it('withdraws decision controls when the source has no actions, even if the caller enables approval', async () => {
        const source = createTestSessionTranscriptSource({
            interaction: { canApprovePermissions: true, canSendMessages: true },
            actions: null,
        });
        const screen = await renderWithSessionTranscriptSource(
            <PermissionFooter sessionId="s1" permission={{ id: 'p1', status: 'pending' }} toolName="Read"
                metadata={{ flavor: 'claude' }} canApprovePermissions />,
            source,
        );
        expect(screen.findAllByProps({ testID: 'permission-footer.allow' })).toHaveLength(0);
        expect(screen.findAllByProps({ testID: 'permission-footer.deny' })).toHaveLength(0);
    });

    it('keeps execution-run responses with the run when session actions exist', async () => {
        const respondToPermission = vi.fn(async () => {});
        const respond = vi.fn(async () => {});
        const source = createTestSessionTranscriptSource({
            interaction: { canApprovePermissions: true, canSendMessages: true },
            actions: { respondToPermission, answerUserAction: vi.fn(), abort: vi.fn(), submitMessage: vi.fn() },
        });
        const screen = await renderWithSessionTranscriptSource(
            <PermissionFooter executionRun={{ executionRunId: 'run1', respond, pendingRequestIds: new Set() }}
                permission={{ id: 'run-request', status: 'pending' }} toolName="Read" canApprovePermissions />,
            source,
        );
        await pressTestInstanceAsync(screen.findByProps({ testID: 'permission-footer.allow' }), 'run allow');
        expect(respond).toHaveBeenCalledWith({ requestId: 'run-request', approved: true });
        expect(respondToPermission).not.toHaveBeenCalled();
    });

    it('withdraws session answers when the interaction forbids approval despite an action carrier', async () => {
        const respondToPermission = vi.fn(async () => {});
        const screen = await renderWithSessionTranscriptSource(
            <PermissionFooter sessionId="s1" permission={{ id: 'p1', status: 'pending' }} toolName="Read"
                metadata={{ flavor: 'claude' }} canApprovePermissions />,
            createTestSessionTranscriptSource({
                interaction: { canSendMessages: true, canApprovePermissions: false },
                actions: { respondToPermission, answerUserAction: vi.fn(), abort: vi.fn(), submitMessage: vi.fn() },
            }),
        );
        expect(screen.findAllByProps({ testID: 'permission-footer.allow' })).toHaveLength(0);
        expect(respondToPermission).not.toHaveBeenCalled();
    });
});
