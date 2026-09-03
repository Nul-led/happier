/**
 * Protocol-owned physical ceilings for Account Collection data. Deployment
 * policy can lower these values, but neither a manifest nor an operator can
 * raise a wire or persisted-data shape beyond this compatibility boundary.
 */
export const PLUGIN_COLLECTION_QUERY_MAX_ROWS_V1 = 200;
export const PLUGIN_COLLECTION_MUTATION_BATCH_MAX_ROWS_V1 = 100;

export const PLUGIN_COLLECTION_LIMITS_V1 = Object.freeze({
  maximumStoredRowEncodedBytes: 2 * 1024 * 1024,
  maximumPrivateEnvelopeEncodedBytes: 512 * 1024,
  maximumProjectionEncodedBytes: 64 * 1024,
  maximumMutationBatchEncodedBytes: 64 * 1024 * 1024,
  maximumMutationBatchRows: PLUGIN_COLLECTION_MUTATION_BATCH_MAX_ROWS_V1,
  maximumAccountEncodedBytes: 1024 * 1024 * 1024,
  maximumAccountRows: 100_000,
});

/**
 * The Account Collection deployment policy this platform ships. An operator can
 * lower any dimension, so it is the assumption a client uses only until the
 * connected deployment publishes its effective `pluginDataCollections`
 * capability — never a substitute for the published value, and never a ceiling.
 */
export const PLUGIN_COLLECTION_DEFAULT_DEPLOYMENT_LIMITS_V1 = Object.freeze({
  maxRowEncodedBytes: 512 * 1024,
  maxBatchBytes: 16 * 1024 * 1024,
  maxBatchRows: PLUGIN_COLLECTION_MUTATION_BATCH_MAX_ROWS_V1,
  maxAccountRows: 10_000,
  maxAccountBytes: 256 * 1024 * 1024,
});

/**
 * The largest Collection `schemaVersion` the persisted column can hold.
 *
 * Derived from the storage boundary, not from a chosen policy number: every
 * provider persists `schemaVersion` as a Prisma `Int`, which the MySQL provider
 * emits as `INTEGER NOT NULL` — a signed 32-bit column — in
 * `PluginCollectionContract` and `PluginCollectionRow`
 * (`apps/server/prisma/mysql/migrations/20260809170000_add_plugin_data_and_message_admission/migration.sql`).
 * The column also carries the `PluginCollectionContract_identity_schema_key`
 * unique identity, so a version the column cannot hold is not a value that
 * merely fails to store: on SQLite (64-bit INTEGER) it would persist an identity
 * MySQL can never reproduce. Admission rejects it at the wire instead, where the
 * failure is typed and attributable.
 */
export const PLUGIN_COLLECTION_SCHEMA_VERSION_MAX = 2_147_483_647;

/**
 * The largest Collection row revision — and absence epoch — the persisted
 * columns can hold.
 *
 * Derived from the same storage boundary as `PLUGIN_COLLECTION_SCHEMA_VERSION_MAX`,
 * not from a chosen policy number. Every Collection currentness column is a
 * Prisma `Int`, emitted as `INTEGER` by all three providers: signed 32-bit on
 * PostgreSQL and MySQL, dynamic 64-bit on SQLite. The columns are
 * `PluginCollectionRow.revision` and `PluginCollectionAbsenceEpoch.epoch` plus
 * every derived witness — `PluginCollectionProjection.rowRevision`,
 * `PluginCollectionIndexEntry.rowRevision`,
 * `PluginCollectionRelation.sourceRevision`,
 * `PluginCollectionIndexState.indexedThroughRevision`, and
 * `PluginCollectionCandidatePreparationStage.sourceRevision`
 * (`apps/server/prisma{,/mysql,/sqlite}/migrations/20260809170000_add_plugin_data_and_message_admission/migration.sql`
 * and `.../20260829150000_add_plugin_collection_absence_epoch/migration.sql`).
 * Allowing a larger value would not merely fail to store: SQLite would persist
 * exact-CAS currentness the other two providers can never reproduce.
 *
 * Revisions and the absence epoch share one monotone space rather than two
 * limits: an absent create is seeded from `absenceEpoch + 1`, and a forget
 * advances the epoch past the retired revision. The Collection mutation owner
 * refuses the increment that would leave this ceiling with one typed
 * `collection_revision_exhausted` result instead of overflowing.
 */
export const PLUGIN_COLLECTION_REVISION_MAX = 2_147_483_647;
