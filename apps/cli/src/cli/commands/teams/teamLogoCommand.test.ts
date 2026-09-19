import { describe, expect, it, vi } from 'vitest';

const executeCommand = vi.hoisted(() => ({
    run: vi.fn(async (_params: Readonly<{ argv: readonly string[] }>) => {}),
}));
vi.mock('@/cli/actions/executeCommand', () => ({ runCompiledActionCliCommand: executeCommand.run }));

import { tryHandleTeamLogoFileCliCommand } from './teamLogoCommand';
import { readTeamLogoSourceFromFile } from './teamLogoFile';

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x01, 0x02]);
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);

describe('happier teams logo set --image-file', () => {
    it('sends the local file as the canonical Team-logo input and forwards every other flag', async () => {
        executeCommand.run.mockClear();
        const handled = await tryHandleTeamLogoFileCliCommand({
            argv: ['teams', 'logo', 'set', '--team-id', 'team-1', '--image-file', './logo.png', '--json'],
            deps: { readFileFn: async () => PNG },
        });

        expect(handled).toBe(true);
        expect(executeCommand.run.mock.calls[0]?.[0]?.argv).toEqual([
            'teams', 'logo', 'set',
            '--image-json', JSON.stringify({
                mimeType: 'image/png',
                dataBase64: Buffer.from(PNG).toString('base64'),
            }),
            '--team-id', 'team-1', '--json',
        ]);
    });

    it('leaves an ordinary invocation to the compiled command', async () => {
        executeCommand.run.mockClear();
        await expect(tryHandleTeamLogoFileCliCommand({
            argv: ['teams', 'logo', 'set', '--team-id', 'team-1', '--image-json', '{}'],
        })).resolves.toBe(false);
        await expect(tryHandleTeamLogoFileCliCommand({ argv: ['teams', 'update'] })).resolves.toBe(false);
        expect(executeCommand.run).not.toHaveBeenCalled();
    });

    it('refuses two sources for the same image', async () => {
        await expect(tryHandleTeamLogoFileCliCommand({
            argv: ['teams', 'logo', 'set', '--image-file', './a.png', '--image-json', '{}'],
            deps: { readFileFn: async () => PNG },
        })).rejects.toMatchObject({ code: 'invalid_arguments' });
    });

    it('reads the type from the bytes, not the extension', async () => {
        await expect(readTeamLogoSourceFromFile('./photo.png', { readFileFn: async () => JPEG }))
            .resolves.toMatchObject({ mimeType: 'image/jpeg' });
        await expect(readTeamLogoSourceFromFile('./not-an-image.png', {
            readFileFn: async () => new Uint8Array([0x25, 0x50, 0x44, 0x46]),
        })).rejects.toMatchObject({ code: 'invalid_arguments' });
    });

    it('refuses a file beyond the decoder source budget before encoding it', async () => {
        const { TEAM_LOGO_MAX_SOURCE_BYTES_V1 } = await import('@happier-dev/protocol');
        const oversized = new Uint8Array(TEAM_LOGO_MAX_SOURCE_BYTES_V1 + 1);
        oversized.set(PNG.subarray(0, 8));
        await expect(readTeamLogoSourceFromFile('./big.png', { readFileFn: async () => oversized }))
            .rejects.toMatchObject({ code: 'invalid_arguments' });
    });
});
