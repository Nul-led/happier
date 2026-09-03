import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  cleanupPersonalHomeRelocationUpload,
  consumePersonalHomeRelocationUpload,
  preparePersonalHomeRelocationUpload,
} from './relocationTransfer.js';

describe('Personal Home relocation upload reception', () => {
  it('reuses a durable operation receipt across process calls and cleans only its exact transfer directory', async () => {
    const temporaryRoot = await mkdtemp(join(tmpdir(), 'happier-relocation-transfer-test-'));
    const operationId = 'operation-restart-safe';
    try {
      const prepared = await preparePersonalHomeRelocationUpload({ operationId, temporaryRoot, platform: 'linux' });
      expect(prepared).toEqual(expect.objectContaining({ operationId }));
      expect(prepared.uploadLocator).not.toContain('PersonalHome');
      expect((await stat(join(prepared.uploadLocator, '..'))).mode & 0o777).toBe(0o700);

      await writeFile(prepared.uploadLocator, 'verified bundle bytes', { mode: 0o600 });
      const retried = await preparePersonalHomeRelocationUpload({ operationId, temporaryRoot, platform: 'linux' });
      expect(retried).toEqual(prepared);
      await expect(consumePersonalHomeRelocationUpload({
        operationId,
        uploadReceipt: prepared.uploadReceipt,
        temporaryRoot,
      })).resolves.toEqual({ archivePath: prepared.uploadLocator });
      await expect(consumePersonalHomeRelocationUpload({
        operationId,
        uploadReceipt: '99999999-9999-4999-8999-999999999999',
        temporaryRoot,
      })).rejects.toThrow(/does not match/u);

      await cleanupPersonalHomeRelocationUpload({ operationId, temporaryRoot });
      await expect(stat(prepared.uploadLocator)).rejects.toMatchObject({ code: 'ENOENT' });
    } finally {
      await cleanupPersonalHomeRelocationUpload({ operationId, temporaryRoot }).catch(() => undefined);
      await rm(temporaryRoot, { recursive: true, force: true });
    }
  });

  it('recovers an exact operation directory left by a crash before receipt publication without deleting material', async () => {
    const temporaryRoot = await mkdtemp(join(tmpdir(), 'happier-relocation-transfer-test-'));
    const operationId = 'operation-crash-before-receipt';
    try {
      // A previous process created the exact operation directory but died
      // before durably publishing receipt.json.
      const directory = join(
        temporaryRoot,
        'happier-personal-home-relocation',
        createHash('sha256').update(operationId, 'utf8').digest('hex'),
      );
      await mkdir(directory, { recursive: true, mode: 0o700 });
      const partialArchive = join(directory, 'bundle.tar');
      await writeFile(partialArchive, 'partially transferred bytes', { mode: 0o600 });
      const siblingDirectory = join(temporaryRoot, 'happier-personal-home-relocation', 'other-operation');
      await mkdir(siblingDirectory, { recursive: true, mode: 0o700 });
      await writeFile(join(siblingDirectory, 'receipt.json'), 'other operation receipt\n', { mode: 0o600 });

      const prepared = await preparePersonalHomeRelocationUpload({ operationId, temporaryRoot, platform: 'linux' });

      expect(prepared.uploadLocator).toBe(partialArchive.replaceAll('\\', '/'));
      await expect(readFile(join(directory, 'receipt.json'), 'utf8')).resolves.toContain(prepared.uploadReceipt);
      await expect(stat(partialArchive).then((info) => info.isFile())).resolves.toBe(true);
      await expect(readFile(join(siblingDirectory, 'receipt.json'), 'utf8')).resolves.toBe('other operation receipt\n');
    } finally {
      await rm(temporaryRoot, { recursive: true, force: true });
    }
  });
});
