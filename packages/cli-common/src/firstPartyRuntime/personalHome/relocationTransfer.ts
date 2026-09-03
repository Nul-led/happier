import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { createPersonalHomePathProtection } from './protection.js';
import { replacePersonalHomeFileDurably } from './durableFile.js';

const RECEIPT_VERSION = 1;
const RECEIPT_TOKEN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const OPERATION_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;

type UploadReceiptFile = Readonly<{
  version: typeof RECEIPT_VERSION;
  operationId: string;
  uploadReceipt: string;
}>;

export type PersonalHomeRelocationUpload = Readonly<{
  operationId: string;
  /** Opaque carrier locator. It is deliberately outside the Personal Home root. */
  uploadLocator: string;
  uploadReceipt: string;
}>;

function assertOperationId(operationId: string): void {
  if (!OPERATION_ID.test(operationId)) throw new Error('Invalid Personal Home relocation operation id.');
}

function operationDirectory(operationId: string, temporaryRoot: string): string {
  const digest = createHash('sha256').update(operationId, 'utf8').digest('hex');
  return join(temporaryRoot, 'happier-personal-home-relocation', digest);
}

function parseReceipt(raw: string, operationId: string): UploadReceiptFile {
  const value = JSON.parse(raw) as Record<string, unknown>;
  if (Object.keys(value).some((key) => !['version', 'operationId', 'uploadReceipt'].includes(key))
    || value.version !== RECEIPT_VERSION
    || value.operationId !== operationId
    || typeof value.uploadReceipt !== 'string'
    || !RECEIPT_TOKEN.test(value.uploadReceipt)) {
    throw new Error('Personal Home relocation upload receipt is invalid; transfer cleanup is required.');
  }
  return value as UploadReceiptFile;
}

export async function preparePersonalHomeRelocationUpload(params: Readonly<{
  operationId: string;
  platform?: NodeJS.Platform;
  temporaryRoot?: string;
}>): Promise<PersonalHomeRelocationUpload> {
  assertOperationId(params.operationId);
  const root = join(params.temporaryRoot ?? tmpdir(), 'happier-personal-home-relocation');
  const directory = operationDirectory(params.operationId, params.temporaryRoot ?? tmpdir());
  const receiptPath = join(directory, 'receipt.json');
  const archivePath = join(directory, 'bundle.tar');
  const protect = createPersonalHomePathProtection({ platform: params.platform });
  await mkdir(root, { recursive: true, mode: 0o700 });
  await protect(root, 'directory');
  try {
    const existing = parseReceipt(await readFile(receiptPath, 'utf8'), params.operationId);
    return {
      operationId: params.operationId,
      uploadLocator: archivePath.replaceAll('\\', '/'),
      uploadReceipt: existing.uploadReceipt,
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }

  // A previous process may have created the exact operation directory but died
  // before durably publishing receipt.json. Recover that reservation instead of
  // failing on EEXIST; recursive creation never deletes unrelated material and
  // still fails closed if the path exists as a non-directory.
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await protect(directory, 'directory');
  const receipt: UploadReceiptFile = {
    version: RECEIPT_VERSION,
    operationId: params.operationId,
    uploadReceipt: randomUUID(),
  };
  const temporaryReceiptPath = join(directory, `receipt.${randomUUID()}.tmp`);
  await writeFile(temporaryReceiptPath, `${JSON.stringify(receipt)}\n`, { mode: 0o600, flag: 'wx' });
  await protect(temporaryReceiptPath, 'file');
  await replacePersonalHomeFileDurably(temporaryReceiptPath, receiptPath);
  await protect(receiptPath, 'file');
  return {
    operationId: params.operationId,
    uploadLocator: archivePath.replaceAll('\\', '/'),
    uploadReceipt: receipt.uploadReceipt,
  };
}

export async function consumePersonalHomeRelocationUpload(params: Readonly<{
  operationId: string;
  uploadReceipt: string;
  temporaryRoot?: string;
}>): Promise<Readonly<{ archivePath: string }>> {
  assertOperationId(params.operationId);
  if (!RECEIPT_TOKEN.test(params.uploadReceipt)) throw new Error('Invalid Personal Home relocation upload receipt.');
  const directory = operationDirectory(params.operationId, params.temporaryRoot ?? tmpdir());
  const receipt = parseReceipt(await readFile(join(directory, 'receipt.json'), 'utf8'), params.operationId);
  if (receipt.uploadReceipt !== params.uploadReceipt) throw new Error('Personal Home relocation upload receipt does not match the reserved transfer.');
  const archivePath = join(directory, 'bundle.tar');
  const info = await stat(archivePath);
  if (!info.isFile()) throw new Error('Personal Home relocation upload is not a regular file.');
  return { archivePath };
}

export async function cleanupPersonalHomeRelocationUpload(params: Readonly<{
  operationId: string;
  temporaryRoot?: string;
}>): Promise<void> {
  assertOperationId(params.operationId);
  await rm(operationDirectory(params.operationId, params.temporaryRoot ?? tmpdir()), { recursive: true, force: true });
}

/** Whether the exact operation still reserves destination-side temporary
 * transfer material. Abort uses this to distinguish an orphaned reservation
 * from an operation with no destination state at all. */
export async function hasPersonalHomeRelocationUploadReservation(params: Readonly<{
  operationId: string;
  temporaryRoot?: string;
}>): Promise<boolean> {
  assertOperationId(params.operationId);
  try {
    const info = await stat(operationDirectory(params.operationId, params.temporaryRoot ?? tmpdir()));
    return info.isDirectory();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}
