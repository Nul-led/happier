import { access, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { withTempDir } from '@/testkit/fs/tempDir';
import { withHerdrApi } from '@/integrations/herdr/herdrApi.testkit';
import { writeExecutableShim } from '@/testkit/fs/executableShim';
import { writeTerminalHostAttachmentInfo } from '@/terminal/attachment/terminalAttachmentInfo';
import { prepareHerdrTerminalContext } from './prepareHerdrTerminalContext';
import { resolveTerminalHostUnavailableSpawnErrorDetail } from '@/integrations/terminal/host/errors';

// Only the installed executable is substituted; native inventory execution,
// exact socket transport and local descriptor parsing remain real.
describe.skipIf(process.platform === 'win32')('prepareHerdrTerminalContext', () => {
    it('preserves the existing actionable missing-installation outcome at precommit admission', async () => {
        await withTempDir('herdr-unavailable-context-', async happyHomeDir => {
            const error = await prepareHerdrTerminalContext({ happyHomeDir, sessionName: 'selected',
                processEnv: { ...process.env, HERDR_BIN_PATH: join(happyHomeDir, 'not-installed') } }).catch((failure: unknown) => failure);
            expect(resolveTerminalHostUnavailableSpawnErrorDetail(error)).toEqual({
                kind: 'terminal_host_unavailable', host: 'herdr', reason: 'installation_unavailable',
            });
        });
    });
    it.each(['fresh', 'retained', 'unreadable', 'unsupported'] as const)(
        'captures admitted context without replacing retained authority (%s)', async contract => {
            await withTempDir('herdr-admitted-context-', async happyHomeDir => {
                await withHerdrApi(async selected => await withHerdrApi(async ambient => {
                    selected.setServerVersion(contract === 'unsupported' ? '0.9.1' : '0.9.3');
                    const inventoryRead = join(happyHomeDir, 'inventory-read');
                    const binary = await writeExecutableShim({ dir: happyHomeDir, fileName: 'herdr', contents:
                        `#!${process.execPath}\nconst args=process.argv.slice(2).join(' ');\nif(args==='--version')console.log('herdr 0.9.3');\nelse if(args==='session list --json'){require('node:fs').writeFileSync(${JSON.stringify(inventoryRead)},'read');console.log(JSON.stringify({sessions:[{name:'selected',socket_path:process.env.SYNTHETIC_SELECTED_SOCKET,running:true}]}));}\nelse process.exit(1);\n` });
                    if (contract === 'unreadable') {
                        await mkdir(join(happyHomeDir, 'terminal', 'sessions'), { recursive: true });
                        await writeFile(join(happyHomeDir, 'terminal', 'sessions', 'same-session.host.json'), '{malformed');
                    } else if (contract !== 'fresh') {
                        await writeTerminalHostAttachmentInfo({ happyHomeDir, sessionId: 'same-session',
                            handle: { kind: 'herdr', sessionName: 'selected', socketPath: selected.socketPath,
                                terminalId: 'terminal_1', paneId: 'managed',
                                attachMetadata: { attachStrategy: 'terminal_host', topology: 'shared', locality: 'same_machine', liveProbe: 'required' } } });
                    }
                    const preparing = prepareHerdrTerminalContext({ happyHomeDir,
                        sessionName: contract === 'fresh' ? 'selected' : 'ambient',
                        ...(contract !== 'fresh' ? { existingSessionId: 'same-session' } : {}),
                        processEnv: { ...process.env, HERDR_BIN_PATH: binary, SYNTHETIC_SELECTED_SOCKET: selected.socketPath } });
                    if (contract === 'fresh' || contract === 'retained') {
                        await expect(preparing).resolves.toEqual({ sessionName: 'selected', socketPath: selected.socketPath });
                        expect(selected.requests.map(request => request.method)).toEqual(['session.snapshot']);
                    } else {
                        await expect(preparing).rejects.toMatchObject(contract === 'unsupported'
                            ? { code: 'terminal_host_startup_failed', reason: 'server_version_unsupported' }
                            : { creationDisposition: 'not_created', cleanupIncomplete: false });
                    }
                    expect(ambient.requests).toEqual([]);
                    if (contract !== 'fresh') await expect(access(inventoryRead)).rejects.toMatchObject({ code: 'ENOENT' });
                }));
            });
        },
    );
});
