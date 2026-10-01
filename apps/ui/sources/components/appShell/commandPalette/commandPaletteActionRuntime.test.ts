import { describe, expect, it } from 'vitest';
import { executeCommandPaletteAction, registerCommandPaletteActionCatalog } from './commandPaletteActionRuntime';
import type { Command } from './types';

describe('mounted command palette Actions', () => {
    it('does not reclassify commands with an existing Action policy as generic host commands', async () => {
        let invoked = false;
        const release = registerCommandPaletteActionCatalog(() => [{
            id: 'action:ui.voice_global.reset', title: 'Reset voice', actionSpecId: 'ui.voice_global.reset',
            action: () => { invoked = true; },
        }]);
        try {
            await expect(executeCommandPaletteAction({ actionId: 'ui.command_palette.list', input: {}, context: { surface: 'agent' } }))
                .resolves.toEqual({ ok: true, result: { commands: [] } });
            await expect(executeCommandPaletteAction({ actionId: 'ui.command_palette.invoke', input: { commandId: 'action:ui.voice_global.reset' }, context: { surface: 'agent' } }))
                .resolves.toMatchObject({ ok: false, errorCode: 'unsupported_action' });
            expect(invoked).toBe(false);
        } finally { release(); }
    });
    it('reads current entries and invokes the latest callback instead of a retained command', async () => {
        let destination = '';
        let commands: readonly Command[] = [{ id: 'account', title: 'Account', action: () => { destination = 'old'; } }];
        const release = registerCommandPaletteActionCatalog(() => commands);
        try {
            await expect(executeCommandPaletteAction({ actionId: 'ui.command_palette.list', input: {}, context: {} }))
                .resolves.toEqual({ ok: true, result: { commands: [{ id: 'account', title: 'Account' }] } });
            commands = [{ id: 'account', title: 'Current account', action: () => { destination = 'current'; } }];
            await expect(executeCommandPaletteAction({ actionId: 'ui.command_palette.invoke', input: { commandId: 'account' }, context: {} }))
                .resolves.toEqual({ ok: true, result: { invoked: true } });
            expect(destination).toBe('current');
            commands = [];
            await expect(executeCommandPaletteAction({ actionId: 'ui.command_palette.invoke', input: { commandId: 'account' }, context: {} }))
                .resolves.toMatchObject({ ok: false, errorCode: 'unsupported_action' });
            expect(destination).toBe('current');
        } finally { release(); }
    });

    it('retires mounts without clearing a newer owner and refuses cancelled or unmounted invocation', async () => {
        let invoked = false;
        const oldRelease = registerCommandPaletteActionCatalog(() => []);
        const release = registerCommandPaletteActionCatalog(() => [{ id: 'new-session', title: 'New session', action: () => { invoked = true; } }]);
        oldRelease();
        const cancellation = new AbortController();
        cancellation.abort();
        try {
            await expect(executeCommandPaletteAction({ actionId: 'ui.command_palette.invoke', input: { commandId: 'new-session' }, context: { signal: cancellation.signal } }))
                .resolves.toMatchObject({ ok: false });
            expect(invoked).toBe(false);
            await expect(executeCommandPaletteAction({ actionId: 'ui.command_palette.invoke', input: { commandId: 'new-session' }, context: {} }))
                .resolves.toMatchObject({ ok: true });
            expect(invoked).toBe(true);
        } finally { release(); }
        await expect(executeCommandPaletteAction({ actionId: 'ui.command_palette.list', input: {}, context: {} }))
            .resolves.toMatchObject({ ok: false, errorCode: 'unsupported_action' });
    });
});
