import { describe, expect, it } from 'vitest';

import { planServiceAction } from './manager.js';

describe('planServiceAction (systemd install)', () => {
    it('restarts the unit after install so unit/env changes take effect (system mode)', () => {
        const plan = planServiceAction({
            backend: 'systemd-system',
            action: 'install',
            label: 'happier-server-dev',
            definitionPath: '/etc/systemd/system/happier-server-dev.service',
            definitionContents: '[Unit]\nDescription=test\n',
            persistent: true,
        });

        expect(plan.commands).toEqual([
            { cmd: 'systemctl', args: ['daemon-reload'] },
            { cmd: 'systemctl', args: ['enable', 'happier-server-dev.service'] },
            { cmd: 'systemctl', args: ['restart', 'happier-server-dev.service'] },
        ]);
    });

    it('restarts the unit after install so unit/env changes take effect (user mode)', () => {
        const plan = planServiceAction({
            backend: 'systemd-user',
            action: 'install',
            label: 'happier-server-dev',
            definitionPath: '/home/dev/.config/systemd/user/happier-server-dev.service',
            definitionContents: '[Unit]\nDescription=test\n',
            persistent: true,
        });

        expect(plan.commands).toEqual([
            { cmd: 'systemctl', args: ['--user', 'daemon-reload'] },
            { cmd: 'systemctl', args: ['--user', 'enable', 'happier-server-dev.service'] },
            { cmd: 'systemctl', args: ['--user', 'restart', 'happier-server-dev.service'] },
        ]);
    });

    it('reloads a freshly written transient start definition before starting it', () => {
        const plan = planServiceAction({
            backend: 'systemd-user',
            action: 'start',
            label: 'happier-server-dev',
            definitionPath: '/home/dev/.config/systemd/user/happier-server-dev.service',
            definitionContents: '[Service]\nEnvironment=HAPPIER_SERVER_STARTUP_RECEIPT_NONCE=fresh\n',
            persistent: false,
        });

        expect(plan.writes).toHaveLength(1);
        expect(plan.commands).toEqual([
            { cmd: 'systemctl', args: ['--user', 'daemon-reload'] },
            { cmd: 'systemctl', args: ['--user', 'start', 'happier-server-dev.service'] },
        ]);
    });
});
