import { describe, expect, it } from 'vitest';

import { buildSessionTerminalNewMenuItems } from './sessionTerminalMenus';

describe('terminal script menu', () => {
    it('offers the full script inventory after the runnable scripts', () => {
        const items = buildSessionTerminalNewMenuItems({
            folder: 'happier', machineName: 'MacBook Pro', agent: null, machines: [],
            scripts: [{ id: 'dev', title: 'dev', command: 'yarn dev' }],
        }, () => null, () => null);
        expect(items.findIndex((item) => item.id === 'allScripts')).toBeGreaterThan(items.findIndex((item) => item.id === 'script:dev'));
        expect(items.find((item) => item.id === 'allScripts')?.disabled).not.toBe(true);
    });
});
