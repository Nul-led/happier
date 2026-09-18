import { beforeEach, describe, expect, it, vi } from 'vitest';

const show = vi.hoisted(() => vi.fn(() => 'modal-1'));

vi.mock('@/modal', () => ({ Modal: { show } }));
vi.mock('@/text', () => ({ t: (key: string) => key }));
vi.mock('./ActionOperationDetailModal', () => ({ ActionOperationDetailModal: 'ActionOperationDetailModal' }));

describe('openActionOperationDetail', () => {
    beforeEach(() => show.mockClear());

    it('opens the shared live detail by exact Home-qualified operation address', async () => {
        const { openActionOperationDetail } = await import('./openActionOperationDetail');
        openActionOperationDetail({ serverId: 'home-a', operationId: 'operation-1' });

        expect(show).toHaveBeenCalledWith({
            component: 'ActionOperationDetailModal',
            props: { serverId: 'home-a', operationId: 'operation-1' },
            closeOnBackdrop: true,
            accessibilityLabel: 'inbox.actionOperations.detailAccessibilityLabel',
        });
    });

    it('does not open detail for an unqualified legacy operation', async () => {
        const { openActionOperationDetail } = await import('./openActionOperationDetail');
        openActionOperationDetail({ serverId: null, operationId: 'operation-1' });

        expect(show).not.toHaveBeenCalled();
    });
});
