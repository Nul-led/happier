import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { writeStartupReceiptFromEnvironment } from './startupReceipt';

describe('writeStartupReceiptFromEnvironment', () => {
    it('atomically records the private activation identity and actual bound listener', async () => {
        const root = await mkdtemp(join(tmpdir(), 'happier-server-startup-receipt-'));
        try {
            const receiptPath = join(root, 'startup.json');
            await expect(writeStartupReceiptFromEnvironment({
                HAPPIER_SERVER_STARTUP_RECEIPT_PATH: receiptPath,
                HAPPIER_SERVER_STARTUP_RECEIPT_NONCE: 'activation-nonce-1',
            }, {
                server: {
                    address: () => ({ address: '::ffff:127.0.0.1', family: 'IPv6', port: 43123 }),
                },
            }, {
                authenticated: true,
                homeServerIdentityId: 'srv_home_readiness',
                accountCount: 2,
                sessionCount: 3,
            })).resolves.toBe(true);

            await expect(readFile(receiptPath, 'utf8').then(JSON.parse)).resolves.toEqual({
                nonce: 'activation-nonce-1',
                pid: process.pid,
                host: '127.0.0.1',
                port: 43123,
                personalHomeReadiness: {
                    authenticated: true,
                    homeServerIdentityId: 'srv_home_readiness',
                    accountCount: 2,
                    sessionCount: 3,
                },
            });
        } finally {
            await rm(root, { recursive: true, force: true });
        }
    });

    it('does nothing unless both private activation values are valid', async () => {
        await expect(writeStartupReceiptFromEnvironment({}, null)).resolves.toBe(false);
        await expect(writeStartupReceiptFromEnvironment({
            HAPPIER_SERVER_STARTUP_RECEIPT_PATH: 'relative.json',
            HAPPIER_SERVER_STARTUP_RECEIPT_NONCE: 'activation-nonce-1',
        }, null)).resolves.toBe(false);
    });

    it('refuses to attest startup without a TCP listener address', async () => {
        const root = await mkdtemp(join(tmpdir(), 'happier-server-startup-receipt-no-listener-'));
        try {
            const receiptPath = join(root, 'startup.json');
            await expect(writeStartupReceiptFromEnvironment({
                HAPPIER_SERVER_STARTUP_RECEIPT_PATH: receiptPath,
                HAPPIER_SERVER_STARTUP_RECEIPT_NONCE: 'activation-nonce-1',
            }, {
                server: { address: () => '/tmp/happier.sock' },
            })).resolves.toBe(false);
            await expect(readFile(receiptPath, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
        } finally {
            await rm(root, { recursive: true, force: true });
        }
    });
});
