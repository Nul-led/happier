import { afterEach, describe, expect, it } from 'vitest';

import { renderHook } from '@/dev/testkit/hooks/renderHook';
import { standardCleanup } from '@/dev/testkit/cleanup/standardCleanup';

import { useUiSurfaceRendererMount } from './useUiSurfaceRendererMount';

afterEach(standardCleanup);

function createLifetime() {
    const controller = new AbortController();
    return {
        isCurrent: () => !controller.signal.aborted,
        onRetire: (listener: () => void) => {
            controller.signal.addEventListener('abort', listener);
            return { dispose: () => controller.signal.removeEventListener('abort', listener) };
        },
        retire: () => controller.abort(),
    };
}

describe('physical surface renderer mount', () => {
    it('preserves mount identity across presentation changes while checking current focus eligibility', async () => {
        const lifetime = createLifetime();
        const hook = await renderHook(useUiSurfaceRendererMount, {
            initialProps: { lifetime, interactionEnabled: true, focusEligible: true, mountKey: 'document-a' },
        });
        const first = hook.getCurrent();
        expect(first.identity).not.toBeNull();
        expect(first.isFocusEligible()).toBe(true);
        await hook.rerender({ lifetime, interactionEnabled: true, focusEligible: false, mountKey: 'document-a' });
        expect(hook.getCurrent().identity).toBe(first.identity);
        expect(hook.getCurrent().signal).toBe(first.signal);
        expect(first.isFocusEligible()).toBe(false);
        lifetime.retire();
        expect(first.signal.aborted).toBe(true);
        expect(first.isCurrent()).toBe(false);
    });

    it('retires a replaced physical document and the unmounted renderer', async () => {
        const lifetime = createLifetime();
        const hook = await renderHook(useUiSurfaceRendererMount, {
            initialProps: { lifetime, interactionEnabled: true, focusEligible: true, mountKey: 'document-a' },
        });
        const first = hook.getCurrent();
        await hook.rerender({ lifetime, interactionEnabled: true, focusEligible: true, mountKey: 'document-b' });
        const second = hook.getCurrent();
        expect(first.signal.aborted).toBe(true);
        expect(first.isCurrent()).toBe(false);
        expect(second.identity).not.toEqual(first.identity);
        expect(second.isCurrent()).toBe(true);
        await hook.unmount();
        expect(second.signal.aborted).toBe(true);
    });
});
