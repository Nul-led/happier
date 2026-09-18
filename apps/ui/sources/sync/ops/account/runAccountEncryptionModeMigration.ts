import {
  canonicalSessionDraftAddressV2,
  pluginJsonValuesEqual,
  type AccountEncryptionMigrateRequest,
  type AccountEncryptionMigrateSuccessResponse,
  type SessionDraftRecordV2,
} from '@happier-dev/protocol';

type Params = Readonly<{
  request: AccountEncryptionMigrateRequest;
  migrate(request: AccountEncryptionMigrateRequest): Promise<AccountEncryptionMigrateSuccessResponse>;
  activateTargetMode(): void | Promise<void>;
  acknowledgeSessionDrafts(records: readonly SessionDraftRecordV2[]): void | Promise<void>;
}>;

export async function runAccountEncryptionModeMigration(
  params: Params,
): Promise<AccountEncryptionMigrateSuccessResponse> {
  const result = await params.migrate(params.request);
  const expectedItems = params.request.sessionDrafts?.items ?? [];
  let migratedRecords: readonly SessionDraftRecordV2[] = [];

  if (params.request.sessionDrafts && "v" in params.request.sessionDrafts
    && (!result.sessionDrafts || !("v" in result.sessionDrafts)
      || result.sessionDrafts.v !== params.request.sessionDrafts.v)) {
    throw new Error('Invalid session draft migration response');
  }

  if (expectedItems.length > 0) {
    migratedRecords = result.sessionDrafts?.records ?? [];
    const expectedByAddress = new Map(expectedItems.map((item) => [
      canonicalSessionDraftAddressV2(item.address),
      item,
    ]));
    const responseAddresses = new Set<string>();
    const coverageIsExact = migratedRecords.length === expectedItems.length
      && migratedRecords.every((record) => {
        const canonicalAddress = canonicalSessionDraftAddressV2(record.address);
        const expected = expectedByAddress.get(canonicalAddress);
        if (!expected || responseAddresses.has(canonicalAddress)) return false;
        responseAddresses.add(canonicalAddress);
        return record.address.kind === 'newSession'
          && record.revision === expected.expectedRevision + 1
          && record.content !== null
          && pluginJsonValuesEqual(record.content, expected.content);
      });
    if (!coverageIsExact) {
      throw new Error('Invalid session draft migration response');
    }
  }

  await params.activateTargetMode();
  if (migratedRecords.length > 0) {
    await params.acknowledgeSessionDrafts(migratedRecords);
  }
  return result;
}
